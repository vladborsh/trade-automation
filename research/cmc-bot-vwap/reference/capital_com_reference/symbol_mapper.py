"""
Symbol mapping utilities for Capital.com API

Maps common symbol names to Capital.com epic codes
"""

from typing import Dict, Optional


class SymbolMapper:
    """Maps trading symbols to Capital.com epic codes"""

    # Forex pairs
    FOREX_MAPPINGS: Dict[str, str] = {
        'EURUSD': 'EURUSD',
        'EUR/USD': 'EURUSD',
        'GBPUSD': 'GBPUSD',
        'GBP/USD': 'GBPUSD',
        'USDJPY': 'USDJPY',
        'USD/JPY': 'USDJPY',
        'USDCHF': 'USDCHF',
        'USD/CHF': 'USDCHF',
        'AUDUSD': 'AUDUSD',
        'AUD/USD': 'AUDUSD',
        'USDCAD': 'USDCAD',
        'USD/CAD': 'USDCAD',
        'NZDUSD': 'NZDUSD',
        'NZD/USD': 'NZDUSD',
        'EURGBP': 'EURGBP',
        'EUR/GBP': 'EURGBP',
        'EURJPY': 'EURJPY',
        'EUR/JPY': 'EURJPY',
        'GBPJPY': 'GBPJPY',
        'GBP/JPY': 'GBPJPY',
    }

    # Cryptocurrency pairs
    CRYPTO_MAPPINGS: Dict[str, str] = {
        'BTCUSD': 'BITCOIN',
        'BTC/USD': 'BITCOIN',
        'BITCOIN': 'BITCOIN',
        'ETHUSD': 'ETHEREUM',
        'ETH/USD': 'ETHEREUM',
        'ETHEREUM': 'ETHEREUM',
        'LTCUSD': 'LITECOIN',
        'LTC/USD': 'LITECOIN',
        'LITECOIN': 'LITECOIN',
        'XRPUSD': 'RIPPLE',
        'XRP/USD': 'RIPPLE',
        'RIPPLE': 'RIPPLE',
        'BCHUSD': 'BITCOIN_CASH',
        'BCH/USD': 'BITCOIN_CASH',
        'ADAUSD': 'CARDANO',
        'ADA/USD': 'CARDANO',
        'DOTUSD': 'POLKADOT',
        'DOT/USD': 'POLKADOT',
        'LINKUSD': 'CHAINLINK',
        'LINK/USD': 'CHAINLINK',
    }

    # Commodities
    COMMODITIES_MAPPINGS: Dict[str, str] = {
        'XAUUSD': 'GOLD',
        'GOLD': 'GOLD',
        'XAGUSD': 'SILVER',
        'SILVER': 'SILVER',
        'CRUDE': 'CRUDE_OIL_BRENT',
        'OIL': 'CRUDE_OIL_BRENT',
        'BRENT': 'CRUDE_OIL_BRENT',
        'WTI': 'CRUDE_OIL_WTI',
        'NATURAL_GAS': 'NATURAL_GAS',
        'NATGAS': 'NATURAL_GAS',
    }

    # Indices
    INDICES_MAPPINGS: Dict[str, str] = {
        'SPX500': 'US_500',
        'SP500': 'US_500',
        'S&P500': 'US_500',
        'US500': 'US_500',
        'NAS100': 'US_TECH_100',
        'NASDAQ': 'US_TECH_100',
        'NDX': 'US_TECH_100',
        'DJI': 'WALL_STREET',
        'DOW': 'WALL_STREET',
        'FTSE100': 'UK_100',
        'FTSE': 'UK_100',
        'DAX': 'GERMANY_40',
        'DAX40': 'GERMANY_40',
        'CAC40': 'FRANCE_40',
        'NIKKEI': 'JAPAN_225',
        'NIKKEI225': 'JAPAN_225',
    }

    @classmethod
    def map_symbol(cls, symbol: str, asset_type: str) -> str:
        """
        Map a symbol to Capital.com epic code

        Args:
            symbol: Symbol to map (e.g., 'EURUSD', 'BTCUSD')
            asset_type: Asset type ('forex', 'crypto', 'cryptocurrencies', 'commodities', 'indices')

        Returns:
            Capital.com epic code

        Raises:
            ValueError: If symbol mapping is not found
        """
        # Normalize symbol
        symbol_upper = symbol.upper().strip()

        # Determine the correct mapping dictionary
        if asset_type.lower() in ['crypto', 'cryptocurrency', 'cryptocurrencies']:
            mappings = cls.CRYPTO_MAPPINGS
        elif asset_type.lower() in ['forex', 'fx', 'currencies']:
            mappings = cls.FOREX_MAPPINGS
        elif asset_type.lower() in ['commodities', 'commodity', 'metals', 'precious metals']:
            mappings = cls.COMMODITIES_MAPPINGS
        elif asset_type.lower() in ['indices', 'index', 'stocks']:
            mappings = cls.INDICES_MAPPINGS
        else:
            # Try all mappings
            for mapping_dict in [cls.FOREX_MAPPINGS, cls.CRYPTO_MAPPINGS,
                                 cls.COMMODITIES_MAPPINGS, cls.INDICES_MAPPINGS]:
                if symbol_upper in mapping_dict:
                    return mapping_dict[symbol_upper]

            # If not found, return as-is (might work directly)
            print(f"⚠️  Symbol '{symbol}' not found in mappings for asset_type '{asset_type}', using as-is")
            return symbol_upper

        # Look up in the specific mapping
        if symbol_upper in mappings:
            return mappings[symbol_upper]

        # If not found, return as-is
        print(f"⚠️  Symbol '{symbol}' not found in {asset_type} mappings, using as-is")
        return symbol_upper

    @classmethod
    def get_all_symbols(cls, asset_type: Optional[str] = None) -> Dict[str, str]:
        """
        Get all available symbol mappings

        Args:
            asset_type: Optional filter by asset type

        Returns:
            Dictionary of symbol mappings
        """
        if asset_type is None:
            # Return all mappings
            all_mappings = {}
            all_mappings.update(cls.FOREX_MAPPINGS)
            all_mappings.update(cls.CRYPTO_MAPPINGS)
            all_mappings.update(cls.COMMODITIES_MAPPINGS)
            all_mappings.update(cls.INDICES_MAPPINGS)
            return all_mappings

        # Return specific asset type mappings
        if asset_type.lower() in ['crypto', 'cryptocurrency', 'cryptocurrencies']:
            return cls.CRYPTO_MAPPINGS.copy()
        elif asset_type.lower() in ['forex', 'fx', 'currencies']:
            return cls.FOREX_MAPPINGS.copy()
        elif asset_type.lower() in ['commodities', 'commodity', 'metals']:
            return cls.COMMODITIES_MAPPINGS.copy()
        elif asset_type.lower() in ['indices', 'index', 'stocks']:
            return cls.INDICES_MAPPINGS.copy()
        else:
            return {}
