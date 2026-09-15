"""
Utility functions for Capital.com data processing
"""

import pandas as pd
from datetime import datetime
from typing import List, Dict, Optional


def process_price_data(prices: List[Dict]) -> Optional[pd.DataFrame]:
    """
    Convert Capital.com API price data to pandas DataFrame

    Args:
        prices: List of price dictionaries from Capital.com API

    Returns:
        DataFrame with OHLCV data, indexed by timestamp
        None if processing fails or no data
    """
    if not prices:
        return None

    try:
        # Debug: Show first record structure
        print(f"\n🔍 DEBUG: Processing {len(prices)} price records")
        print(f"🔍 First record structure: {list(prices[0].keys())}")
        print(f"🔍 First record sample: {prices[0]}")

        # Extract data into lists
        timestamps = []
        opens = []
        highs = []
        lows = []
        closes = []

        for idx, price in enumerate(prices):
            # Parse timestamp
            timestamp_str = price.get('snapshotTimeUTC', price.get('snapshotTime'))
            if timestamp_str:
                # Handle timezone info
                if timestamp_str.endswith('Z'):
                    timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                else:
                    timestamp = datetime.fromisoformat(timestamp_str)

                # Convert to UTC if needed
                if timestamp.tzinfo is not None:
                    timestamp = timestamp.replace(tzinfo=None)

                timestamps.append(timestamp)

                # Debug first record - show raw structure
                if idx == 0:
                    print(f"🔍 First record keys: {list(price.keys())}")

                # Capital.com API returns prices in this format:
                # {
                #   "openPrice": {"bid": 1.234, "ask": 1.235},
                #   "highPrice": {"bid": 1.236, "ask": 1.237},
                #   "lowPrice": {"bid": 1.233, "ask": 1.234},
                #   "closePrice": {"bid": 1.235, "ask": 1.236}
                # }

                # Try to extract OHLC from openPrice/highPrice/lowPrice/closePrice format
                if 'openPrice' in price:
                    open_price = price.get('openPrice', {})
                    high_price = price.get('highPrice', {})
                    low_price = price.get('lowPrice', {})
                    close_price = price.get('closePrice', {})

                    if idx == 0:
                        print(f"🔍 Using openPrice/highPrice format")
                        print(f"🔍 openPrice: {open_price}, closePrice: {close_price}")

                    # Extract bid prices (can be changed to 'ask' if preferred)
                    open_val = float(open_price.get('bid', 0) if isinstance(open_price, dict) else open_price or 0)
                    high_val = float(high_price.get('bid', 0) if isinstance(high_price, dict) else high_price or 0)
                    low_val = float(low_price.get('bid', 0) if isinstance(low_price, dict) else low_price or 0)
                    close_val = float(close_price.get('bid', 0) if isinstance(close_price, dict) else close_price or 0)

                    if idx == 0:
                        print(f"🔍 Extracted OHLC: O={open_val}, H={high_val}, L={low_val}, C={close_val}")

                # Fallback: Try lastTradedPrice or bid format with direct OHLC fields
                elif 'lastTradedPrice' in price or 'bid' in price:
                    price_data = price.get('lastTradedPrice', price.get('bid', {}))

                    if idx == 0:
                        print(f"🔍 Using lastTradedPrice/bid format")
                        print(f"🔍 Price data: {price_data}")

                    if isinstance(price_data, dict) and ('open' in price_data or 'o' in price_data):
                        # Try both long and short field names
                        open_val = float(price_data.get('open', price_data.get('o', 0)))
                        high_val = float(price_data.get('high', price_data.get('h', 0)))
                        low_val = float(price_data.get('low', price_data.get('l', 0)))
                        close_val = float(price_data.get('close', price_data.get('c', 0)))

                        if idx == 0:
                            print(f"🔍 Extracted OHLC: O={open_val}, H={high_val}, L={low_val}, C={close_val}")
                    else:
                        # Unknown format
                        if idx == 0:
                            print(f"⚠️  Unknown price data format: {price_data}")
                        open_val = high_val = low_val = close_val = 0

                # Fallback: Try direct short field names (o, h, l, c)
                elif 'o' in price or 'open' in price:
                    open_val = float(price.get('open', price.get('o', 0)))
                    high_val = float(price.get('high', price.get('h', 0)))
                    low_val = float(price.get('low', price.get('l', 0)))
                    close_val = float(price.get('close', price.get('c', 0)))

                    if idx == 0:
                        print(f"🔍 Using direct o/h/l/c format")
                        print(f"🔍 Extracted OHLC: O={open_val}, H={high_val}, L={low_val}, C={close_val}")

                else:
                    # Unknown format - log warning
                    if idx == 0:
                        print(f"⚠️  WARNING: Unknown API response format!")
                        print(f"⚠️  Available fields: {list(price.keys())}")
                    open_val = high_val = low_val = close_val = 0

                opens.append(open_val)
                highs.append(high_val)
                lows.append(low_val)
                closes.append(close_val)

        if not timestamps:
            return None

        # Create DataFrame
        df = pd.DataFrame({
            'timestamp': timestamps,
            'open': opens,
            'high': highs,
            'low': lows,
            'close': closes
        })

        # Set timestamp as index
        df.set_index('timestamp', inplace=True)

        # Sort by timestamp
        df.sort_index(inplace=True)

        # Remove duplicates (keep last)
        duplicates_count = df.index.duplicated().sum()
        df = df[~df.index.duplicated(keep='last')]
        if duplicates_count > 0:
            print(f"🔍 Removed {duplicates_count} duplicate timestamps")

        # Count rows with all zeros before filtering
        all_zeros_mask = (df['open'] == 0) & (df['high'] == 0) & (df['low'] == 0) & (df['close'] == 0)
        zero_rows_count = all_zeros_mask.sum()

        if zero_rows_count > 0:
            print(f"⚠️  WARNING: {zero_rows_count} out of {len(df)} rows have all zeros!")
            print(f"⚠️  This suggests the API response format doesn't match expected field names")
            print(f"🔍 Sample zero row:")
            if zero_rows_count > 0:
                print(df[all_zeros_mask].head(1))

        # Remove rows with all zeros
        df = df[(df['open'] != 0) | (df['high'] != 0) | (df['low'] != 0) | (df['close'] != 0)]

        if df.empty:
            print(f"❌ ERROR: All rows filtered out! DataFrame is empty after removing zeros.")
            print(f"❌ Original data had {len(timestamps)} records, all resulted in zero values")
            return None

        print(f"✅ Successfully processed {len(df)} price records")
        return df

    except Exception as e:
        print(f"❌ Error processing price data: {e}")
        import traceback
        traceback.print_exc()
        return None


def validate_dataframe(df: pd.DataFrame) -> bool:
    """
    Validate OHLC DataFrame

    Args:
        df: DataFrame to validate

    Returns:
        True if valid, False otherwise
    """
    if df is None or df.empty:
        return False

    required_columns = ['open', 'high', 'low', 'close']

    # Check required columns exist
    if not all(col in df.columns for col in required_columns):
        return False

    # Check for NaN values
    if df[required_columns].isna().any().any():
        print("⚠️  Warning: DataFrame contains NaN values")
        return False

    # Check for negative values
    if (df[required_columns] < 0).any().any():
        print("⚠️  Warning: DataFrame contains negative values")
        return False

    # Check high >= low
    if (df['high'] < df['low']).any():
        print("⚠️  Warning: DataFrame contains high < low")
        return False

    return True


def resample_ohlc(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """
    Resample OHLC data to a different timeframe

    Args:
        df: DataFrame with OHLC data
        timeframe: Target timeframe ('5m', '15m', '1h', '4h', '1d')

    Returns:
        Resampled DataFrame
    """
    timeframe_map = {
        '1m': '1T',
        '5m': '5T',
        '15m': '15T',
        '30m': '30T',
        '1h': '1H',
        '4h': '4H',
        '1d': '1D',
        '1w': '1W'
    }

    freq = timeframe_map.get(timeframe, '1H')

    resampled = df.resample(freq).agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last'
    })

    # Remove rows with NaN (gaps in data)
    resampled = resampled.dropna()

    return resampled


def calculate_data_quality_metrics(df: pd.DataFrame) -> Dict:
    """
    Calculate data quality metrics

    Args:
        df: DataFrame with OHLC data

    Returns:
        Dictionary with quality metrics
    """
    metrics = {
        'total_rows': len(df),
        'date_range': f"{df.index.min()} to {df.index.max()}",
        'missing_values': df.isna().sum().to_dict(),
        'zero_values': (df == 0).sum().to_dict(),
        'duplicates': df.index.duplicated().sum(),
    }

    # Check for gaps in data
    if len(df) > 1:
        time_diffs = df.index.to_series().diff()
        mode_diff = time_diffs.mode()[0] if not time_diffs.mode().empty else None
        if mode_diff:
            gaps = time_diffs[time_diffs > mode_diff * 1.5]
            metrics['data_gaps'] = len(gaps)
            metrics['expected_interval'] = str(mode_diff)
        else:
            metrics['data_gaps'] = 0
            metrics['expected_interval'] = 'unknown'

    return metrics
