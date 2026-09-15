"""
Capital.com API Client

Main client class for interacting with Capital.com API
"""

import time
import requests
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional, Dict, Union

from .trading_hours import (
    is_trading_hour,
    is_weekend,
    get_next_valid_time,
    get_last_valid_time,
    format_trading_session_info,
    get_trading_hours_info
)
from .symbol_mapper import SymbolMapper
from .utils import process_price_data


class CapitalComClient:
    """Client for Capital.com API"""

    # Timeframe mappings for Capital.com API
    TIMEFRAME_MAPPING = {
        '1m': 'MINUTE',
        '5m': 'MINUTE_5',
        '15m': 'MINUTE_15',
        '30m': 'MINUTE_30',
        '1h': 'HOUR',
        '2h': 'HOUR_2',
        '4h': 'HOUR_4',
        '1d': 'DAY',
        '1w': 'WEEK'
    }

    def __init__(self, api_key: str, password: str, identifier: str, demo: bool = True):
        """
        Initialize Capital.com data fetcher

        Args:
            api_key: API key from Capital.com platform
            password: API key custom password
            identifier: Login identifier (email)
            demo: Whether to use demo environment (default: True)
        """
        self.api_key = api_key
        self.password = password
        self.identifier = identifier
        self.demo = demo

        # Set base URL based on environment
        if demo:
            self.base_url = "https://demo-api-capital.backend-capital.com"
        else:
            self.base_url = "https://api-capital.backend-capital.com"

        # Session tokens
        self.cst_token = None
        self.security_token = None
        self.session_active = False
        self.session_start_time = None

        # Symbol mapper
        self.symbol_mapper = SymbolMapper()

        # Timeframe mapping reference
        self.timeframe_mapping = self.TIMEFRAME_MAPPING

    def _make_raw_request(self, method: str, endpoint: str, headers: Dict = None,
                         params: Dict = None, json_data: Dict = None) -> requests.Response:
        """Make HTTP request without session handling (used for session creation)"""
        url = f"{self.base_url}{endpoint}"
        default_headers = {
            'Content-Type': 'application/json',
            'X-CAP-API-KEY': self.api_key
        }

        if headers:
            default_headers.update(headers)

        max_retries = 3
        retry_count = 0

        while retry_count < max_retries:
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    headers=default_headers,
                    params=params,
                    json=json_data,
                    timeout=30
                )

                response.raise_for_status()
                return response

            except requests.exceptions.RequestException as e:
                if hasattr(e, 'response') and e.response is not None:
                    status_code = e.response.status_code
                    response_text = e.response.text

                    # Don't retry on certain errors
                    if status_code == 404:
                        print(f"❌ Capital.com API request failed: {e}")
                        print(f"   Response status: {status_code}")
                        print(f"   Response text: {response_text}")
                        raise  # Re-raise 404 errors immediately

                    # For other errors, print details but continue retrying
                    print(f"⚠️  Capital.com API request failed (attempt {retry_count + 1}): {e}")
                    print(f"   Response status: {status_code}")
                    print(f"   Response text: {response_text}")
                else:
                    print(f"⚠️  Capital.com API network error (attempt {retry_count + 1}): {e}")

                retry_count += 1
                if retry_count < max_retries:
                    wait_time = 2 ** retry_count  # Exponential backoff
                    print(f"   Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    print(f"❌ Max retries ({max_retries}) exceeded")
                    raise

    def _make_request(self, method: str, endpoint: str, headers: Dict = None,
                     params: Dict = None, json_data: Dict = None) -> requests.Response:
        """Make HTTP request with error handling and session management"""
        url = f"{self.base_url}{endpoint}"
        default_headers = {
            'Content-Type': 'application/json',
            'X-CAP-API-KEY': self.api_key
        }

        if headers:
            default_headers.update(headers)

        max_retries = 3
        retry_count = 0
        session_recreated = False  # Track if we've already tried recreating session

        while retry_count < max_retries:
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    headers=default_headers,
                    params=params,
                    json=json_data,
                    timeout=30
                )

                # Handle session expiry (only try once per request)
                if (response.status_code == 401 or response.status_code == 403) and not session_recreated:
                    print(f"🔐 Session may have expired, attempting to recreate...")
                    session_recreated = True  # Mark as attempted regardless of success
                    if self.create_session():
                        # Update headers with new tokens
                        if 'CST' in default_headers:
                            default_headers['CST'] = self.cst_token
                        if 'X-SECURITY-TOKEN' in default_headers:
                            default_headers['X-SECURITY-TOKEN'] = self.security_token
                        retry_count += 1
                        continue
                    else:
                        # Session creation failed, don't retry
                        raise Exception("Failed to create session after authentication error")

                response.raise_for_status()
                return response

            except requests.exceptions.RequestException as e:
                if hasattr(e, 'response') and e.response is not None:
                    status_code = e.response.status_code
                    response_text = e.response.text

                    # Don't retry on certain errors
                    if status_code == 404:
                        print(f"❌ Capital.com API request failed: {e}")
                        print(f"   Response status: {status_code}")
                        print(f"   Response text: {response_text}")
                        raise  # Re-raise 404 errors immediately

                    # For other errors, print details but continue retrying
                    print(f"⚠️  Capital.com API request failed (attempt {retry_count + 1}): {e}")
                    print(f"   Response status: {status_code}")
                    print(f"   Response text: {response_text}")
                else:
                    print(f"⚠️  Capital.com API network error (attempt {retry_count + 1}): {e}")

                retry_count += 1
                if retry_count < max_retries:
                    wait_time = 2 ** retry_count  # Exponential backoff
                    print(f"   Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    print(f"❌ Max retries ({max_retries}) exceeded")
                    raise

    def create_session(self) -> bool:
        """Create trading session and obtain authentication tokens"""
        try:
            print("🔐 Creating Capital.com session...")

            # Create session
            session_data = {
                'identifier': self.identifier,
                'password': self.password,
                'encryptedPassword': False
            }

            response = self._make_raw_request('POST', '/api/v1/session', json_data=session_data)

            # Extract tokens from response headers
            self.cst_token = response.headers.get('CST')
            self.security_token = response.headers.get('X-SECURITY-TOKEN')

            if self.cst_token and self.security_token:
                self.session_active = True
                self.session_start_time = datetime.utcnow()
                print("✅ Capital.com session created successfully")
                return True
            else:
                print("❌ Failed to obtain session tokens")
                return False

        except Exception as e:
            print(f"❌ Failed to create Capital.com session: {e}")
            return False

    def _check_session(self) -> bool:
        """Check if session is still active (10 minute timeout)"""
        if not self.session_active or not self.session_start_time:
            return False

        # Sessions expire after 10 minutes
        session_age = datetime.utcnow() - self.session_start_time
        if session_age.total_seconds() > 550:  # 9:10 to be safe
            print("⏰ Session expired, recreating...")
            return self.create_session()

        return True

    def _get_auth_headers(self) -> Dict[str, str]:
        """Get authentication headers for API requests"""
        if not self._check_session():
            if not self.create_session():
                raise Exception("Failed to create or refresh session")

        return {
            'CST': self.cst_token,
            'X-SECURITY-TOKEN': self.security_token
        }

    def _map_symbol(self, symbol: str, asset_type: str) -> str:
        """Map symbol to Capital.com epic code"""
        return self.symbol_mapper.map_symbol(symbol, asset_type)

    def _process_price_data(self, prices: list) -> Optional[pd.DataFrame]:
        """Process price data into DataFrame"""
        return process_price_data(prices)

    def get_trading_hours_info(self) -> str:
        """Get trading hours information"""
        return get_trading_hours_info()

    def fetch_historical_data(self, symbol: str, asset_type: str,
                            timeframe: str = '1h', years: Optional[Union[int, float]] = None,
                            start_date: Optional[Union[str, datetime]] = None,
                            end_date: Optional[Union[str, datetime]] = None) -> Optional[pd.DataFrame]:
        """
        Fetch historical price data from Capital.com

        Args:
            symbol: Symbol to fetch (will be mapped to Capital.com epic)
            asset_type: 'forex', 'indices', 'crypto', 'cryptocurrency', 'cryptocurrencies', 'commodities', etc.
            timeframe: '5m', '15m', '1h', '4h', '1d'
            years: Number of years of data to fetch (backward compatibility)
            start_date: Start date for data fetching (string or datetime)
            end_date: End date for data fetching (string or datetime)

        Returns:
            DataFrame with OHLCV data or None if failed

        Note:
            - If years is provided, start_date and end_date are ignored
            - If start_date and end_date are provided, years is ignored
            - If only start_date is provided, end_date defaults to current time
            - If only end_date is provided, raises ValueError
            - If none provided, defaults to years=3
        """
        try:
            # Auto-detect crypto symbols and override asset_type if needed
            crypto_indicators = ['BITCOIN', 'BTC', 'ETHEREUM', 'ETH', 'LITECOIN', 'LTC', 'RIPPLE', 'XRP']
            is_likely_crypto = any(indicator in symbol.upper() for indicator in crypto_indicators)

            # Auto-detect precious metals symbols and override asset_type if needed
            metals_indicators = ['GOLD', 'SILVER', 'XAU', 'XAG']
            is_likely_metals = any(indicator in symbol.upper() for indicator in metals_indicators)

            if is_likely_crypto and asset_type not in ['crypto', 'cryptocurrency', 'cryptocurrencies']:
                print(f"   🔄 Auto-detected crypto symbol, overriding asset_type: {asset_type} → cryptocurrencies")
                asset_type = 'cryptocurrencies'
            elif is_likely_metals and asset_type not in ['commodities', 'commodity', 'metals', 'precious metals']:
                print(f"   🔄 Auto-detected precious metals symbol, overriding asset_type: {asset_type} → commodities")
                asset_type = 'commodities'

            # Map symbol to Capital.com format
            epic = self._map_symbol(symbol, asset_type)
            print(f"📊 Fetching {timeframe} {asset_type} data for {symbol} (epic: {epic}) from Capital.com...")

            # Debug: Show the mapping result
            if symbol != epic:
                print(f"   🔄 Symbol mapped: {symbol} → {epic}")

            # Show trading hours info
            print(self.get_trading_hours_info())

            # Parse and validate date parameters
            def parse_date_input(date_input: Union[str, datetime, None]) -> Optional[datetime]:
                """Parse date input into datetime object"""
                if date_input is None:
                    return None

                if isinstance(date_input, datetime):
                    return date_input

                if isinstance(date_input, str):
                    try:
                        # Try parsing ISO format dates
                        if 'T' in date_input:
                            return datetime.fromisoformat(date_input.replace('Z', '+00:00'))
                        else:
                            return datetime.fromisoformat(date_input)
                    except ValueError:
                        try:
                            # Try parsing common formats
                            return datetime.strptime(date_input, '%Y-%m-%d')
                        except ValueError:
                            raise ValueError(f"Unable to parse date: {date_input}. Use ISO format like '2023-01-01' or '2023-01-01T10:00:00'")

                raise ValueError(f"Invalid date type: {type(date_input)}. Use string or datetime object.")

            parsed_start_date = parse_date_input(start_date)
            parsed_end_date = parse_date_input(end_date)

            # Parameter validation and resolution
            if years is not None:
                # Use years parameter (backward compatibility)
                if start_date is not None or end_date is not None:
                    print("⚠️  Both years and date range specified. Using years parameter for backward compatibility.")
                actual_end_date = datetime.utcnow()
                actual_start_date = actual_end_date - timedelta(days=365 * years)
            elif start_date is not None or end_date is not None:
                # Use date range mode
                if start_date is not None and end_date is None:
                    # Default end_date to current time
                    parsed_end_date = datetime.utcnow()
                    print(f"📅 End date not specified, using current time: {parsed_end_date.strftime('%Y-%m-%d %H:%M:%S')} UTC")
                elif start_date is None and end_date is not None:
                    raise ValueError("If end_date is specified, start_date must also be provided")

                # Validate date range
                if parsed_start_date >= parsed_end_date:
                    raise ValueError(f"Start date ({parsed_start_date}) must be before end date ({parsed_end_date})")

                actual_start_date = parsed_start_date
                actual_end_date = parsed_end_date
            else:
                # Default to 3 years
                actual_end_date = datetime.utcnow()
                actual_start_date = actual_end_date - timedelta(days=365 * 3)
                print("📅 No date parameters specified, defaulting to 3 years of data")

            # Map timeframe
            resolution = self.timeframe_mapping.get(timeframe, 'HOUR')

            # Adjust dates to valid trading times
            original_start = actual_start_date
            original_end = actual_end_date

            actual_start_date = get_next_valid_time(actual_start_date)
            # Ensure end date is within trading hours
            if not is_trading_hour(actual_end_date):
                # Get the most recent valid trading time
                actual_end_date = get_last_valid_time(actual_end_date)

            if original_start != actual_start_date:
                print(f"📅 Adjusted start time: {format_trading_session_info(original_start)} → {format_trading_session_info(actual_start_date)}")
            if original_end != actual_end_date:
                print(f"📅 Adjusted end time: {format_trading_session_info(original_end)} → {format_trading_session_info(actual_end_date)}")

            print(f"📅 Final date range: {actual_start_date.strftime('%Y-%m-%d %H:%M')} to {actual_end_date.strftime('%Y-%m-%d %H:%M')} UTC")

            # Format dates for API
            from_date = actual_start_date.strftime('%Y-%m-%dT%H:%M:%S')
            to_date = actual_end_date.strftime('%Y-%m-%dT%H:%M:%S')

            # Prepare request parameters
            headers = self._get_auth_headers()
            params = {
                'resolution': resolution,
                'from': from_date,
                'to': to_date,
                'max': 1000  # Maximum allowed by API
            }

            all_data = []
            current_from = actual_start_date

            # Fetch data in chunks if needed (API has 1000 record limit)
            while current_from < actual_end_date:
                # Skip non-trading periods
                if is_weekend(current_from) or not is_trading_hour(current_from):
                    next_valid = get_next_valid_time(current_from)
                    print(f"  ⏭️  Skipping non-trading period: {format_trading_session_info(current_from)} → {format_trading_session_info(next_valid)}")
                    current_from = next_valid
                    if current_from >= actual_end_date:
                        print(f"  🛑 Reached end date after skipping non-trading period, breaking loop")
                        break

                # Calculate chunk end date
                if timeframe == '5m':
                    chunk_days = 3  # ~864 records (3 days * 24 hours * 12 intervals/hour)
                elif timeframe == '15m':
                    chunk_days = 10  # ~960 records
                elif timeframe == '1h':
                    chunk_days = 41  # ~984 records
                elif timeframe == '4h':
                    chunk_days = 166  # ~996 records
                else:  # 1d
                    chunk_days = 1000  # No real limit for daily

                chunk_end = min(current_from + timedelta(days=chunk_days), actual_end_date)

                # Ensure chunk_end is not before current_from (safety check)
                if chunk_end <= current_from:
                    print(f"  🛑 Invalid chunk range detected, breaking loop")
                    break

                params['from'] = current_from.strftime('%Y-%m-%dT%H:%M:%S')
                params['to'] = chunk_end.strftime('%Y-%m-%dT%H:%M:%S')

                print(f"  📦 Fetching chunk: {params['from']} to {params['to']}")

                try:
                    response = self._make_request('GET', f'/api/v1/prices/{epic}',
                                                headers=headers, params=params)

                    data = response.json()
                    prices = data.get('prices', [])

                    if not prices:
                        print(f"  ⚠️  No data returned for chunk - continuing to next chunk")
                        # Move to next valid time instead of breaking
                        next_time = get_next_valid_time(chunk_end)
                        # Ensure we're making progress to avoid infinite loop
                        if next_time <= current_from:
                            print(f"  🛑 Not making progress, breaking loop")
                            break
                        current_from = next_time
                        continue

                except requests.exceptions.RequestException as e:
                    # Handle 404 and other API errors for specific chunks
                    if hasattr(e, 'response') and e.response is not None:
                        if e.response.status_code == 404:
                            print(f"  ⚠️  Data not available for chunk ({e.response.status_code}) - skipping to next chunk")
                            # Try to continue with next chunk instead of failing completely
                            next_time = get_next_valid_time(chunk_end)
                            if next_time <= current_from:
                                print(f"  🛑 Cannot advance further, breaking loop")
                                break
                            current_from = next_time
                            continue
                        else:
                            print(f"  ❌ API error for chunk: {e.response.status_code} - {e.response.text}")
                            # For other errors, try to continue but log the error
                            next_time = get_next_valid_time(chunk_end)
                            if next_time <= current_from:
                                print(f"  🛑 Cannot advance further after error, breaking loop")
                                break
                            current_from = next_time
                            continue
                    else:
                        # Network or other errors - try to continue
                        print(f"  ❌ Network error for chunk: {e}")
                        next_time = get_next_valid_time(chunk_end)
                        if next_time <= current_from:
                            print(f"  🛑 Cannot advance further after network error, breaking loop")
                            break
                        current_from = next_time
                        continue

                all_data.extend(prices)
                print(f"  ✅ Retrieved {len(prices)} records")

                # Move to next chunk with trading hours consideration
                # Check if we got any data and use the last timestamp + 1 time unit
                if prices:
                    last_timestamp_str = prices[-1]['snapshotTimeUTC']
                    # Handle timezone info properly
                    if last_timestamp_str.endswith('Z'):
                        last_timestamp = datetime.fromisoformat(last_timestamp_str.replace('Z', '+00:00'))
                    else:
                        last_timestamp = datetime.fromisoformat(last_timestamp_str)

                    # Convert to UTC if needed
                    if last_timestamp.tzinfo is not None:
                        last_timestamp = last_timestamp.utctimetuple()
                        last_timestamp = datetime(*last_timestamp[:6])

                    # Add appropriate time increment based on timeframe
                    if timeframe == '5m':
                        next_time = last_timestamp + timedelta(minutes=5)
                    elif timeframe == '15m':
                        next_time = last_timestamp + timedelta(minutes=15)
                    elif timeframe == '1h':
                        next_time = last_timestamp + timedelta(hours=1)
                    elif timeframe == '4h':
                        next_time = last_timestamp + timedelta(hours=4)
                    else:  # 1d
                        next_time = last_timestamp + timedelta(days=1)

                    # Ensure we're at a valid trading time
                    current_from = get_next_valid_time(next_time)
                else:
                    next_time = get_next_valid_time(chunk_end)
                    # Ensure we're making progress
                    if next_time <= current_from:
                        print(f"  🛑 Not making progress in loop, breaking")
                        break
                    current_from = next_time

                # Safety check to prevent infinite loop when approaching end_date
                if current_from >= actual_end_date:
                    print(f"  🛑 Reached end date while advancing to next chunk, breaking loop")
                    break

            if not all_data:
                print(f"❌ No data retrieved for {epic} in requested date range")

                # Try fallback: get recent data (last 30 days) if historical data is not available
                print(f"🔄 Attempting fallback: fetching recent data (last 30 days)")
                fallback_end = datetime.utcnow()
                fallback_start = fallback_end - timedelta(days=30)

                # Adjust to valid trading times
                fallback_start = get_next_valid_time(fallback_start)
                if not is_trading_hour(fallback_end):
                    fallback_end = get_last_valid_time(fallback_end)

                print(f"📅 Fallback date range: {fallback_start.strftime('%Y-%m-%d %H:%M')} to {fallback_end.strftime('%Y-%m-%d %H:%M')} UTC")

                try:
                    params_fallback = {
                        'resolution': resolution,
                        'from': fallback_start.strftime('%Y-%m-%dT%H:%M:%S'),
                        'to': fallback_end.strftime('%Y-%m-%dT%H:%M:%S'),
                        'max': 1000
                    }

                    response = self._make_request('GET', f'/api/v1/prices/{epic}',
                                                headers=headers, params=params_fallback)

                    data = response.json()
                    fallback_prices = data.get('prices', [])

                    if fallback_prices:
                        print(f"✅ Fallback successful: retrieved {len(fallback_prices)} records")
                        all_data.extend(fallback_prices)
                    else:
                        print(f"❌ Fallback also returned no data - {epic} may not support {timeframe} timeframe")
                        return None

                except Exception as fallback_error:
                    print(f"❌ Fallback failed: {fallback_error}")
                    return None

            # Convert to DataFrame
            df = self._process_price_data(all_data)

            if df is not None and not df.empty:
                print(f"✅ Capital.com fetched {len(df)} rows of {timeframe} data for {epic}")
                return df
            else:
                print(f"❌ Failed to process data for {epic}")
                return None

        except Exception as e:
            print(f"❌ Capital.com fetch failed for {symbol}: {e}")
            return None
