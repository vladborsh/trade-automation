"""
Capital.com API Client Library

A Python library for fetching and analyzing financial market data from Capital.com
"""

from .client import CapitalComClient
from .symbol_mapper import SymbolMapper
from .utils import (
    process_price_data,
    validate_dataframe,
    resample_ohlc,
    calculate_data_quality_metrics
)
from .trading_hours import (
    is_trading_hour,
    is_weekend,
    get_next_valid_time,
    get_last_valid_time,
    format_trading_session_info,
    get_trading_hours_info
)

__version__ = '0.1.0'

__all__ = [
    # Main client
    'CapitalComClient',

    # Symbol mapping
    'SymbolMapper',

    # Data processing utilities
    'process_price_data',
    'validate_dataframe',
    'resample_ohlc',
    'calculate_data_quality_metrics',

    # Trading hours utilities
    'is_trading_hour',
    'is_weekend',
    'get_next_valid_time',
    'get_last_valid_time',
    'format_trading_session_info',
    'get_trading_hours_info',
]
