"""
Trading hours utilities for Capital.com

Forex market trading hours: 24/5
- Opens: Sunday 22:00 UTC (Monday 00:00 Sydney time)
- Closes: Friday 22:00 UTC (Saturday 08:00 Sydney time)
"""

from datetime import datetime, timedelta
from typing import Optional


def is_weekend(dt: datetime) -> bool:
    """
    Check if the given datetime falls on a weekend (Saturday or Sunday before 22:00 UTC)

    Args:
        dt: Datetime to check

    Returns:
        True if weekend, False otherwise
    """
    # Saturday is always non-trading
    if dt.weekday() == 5:  # Saturday
        return True

    # Sunday before 22:00 UTC is non-trading
    if dt.weekday() == 6 and dt.hour < 22:  # Sunday
        return True

    return False


def is_trading_hour(dt: datetime) -> bool:
    """
    Check if the given datetime is during Forex trading hours

    Forex trades 24/5:
    - Opens: Sunday 22:00 UTC
    - Closes: Friday 22:00 UTC

    Args:
        dt: Datetime to check (assumed UTC)

    Returns:
        True if during trading hours, False otherwise
    """
    weekday = dt.weekday()
    hour = dt.hour

    # Monday 00:00 - Friday 21:59 UTC: Always trading
    if 0 <= weekday <= 4:  # Monday to Friday
        if weekday == 4 and hour >= 22:  # Friday after 22:00
            return False
        return True

    # Saturday: Never trading
    if weekday == 5:
        return False

    # Sunday: Trading starts at 22:00 UTC
    if weekday == 6:
        return hour >= 22

    return False


def get_next_valid_time(dt: datetime) -> datetime:
    """
    Get the next valid trading time from the given datetime

    Args:
        dt: Starting datetime

    Returns:
        Next valid trading datetime
    """
    current = dt
    max_iterations = 1000  # Safety limit
    iterations = 0

    while not is_trading_hour(current) and iterations < max_iterations:
        weekday = current.weekday()

        # If Saturday, jump to Sunday 22:00 UTC
        if weekday == 5:
            days_to_add = 1
            current = current.replace(hour=22, minute=0, second=0, microsecond=0)
            current = current + timedelta(days=days_to_add)

        # If Sunday before 22:00, jump to Sunday 22:00
        elif weekday == 6 and current.hour < 22:
            current = current.replace(hour=22, minute=0, second=0, microsecond=0)

        # If Friday after 22:00, jump to Sunday 22:00
        elif weekday == 4 and current.hour >= 22:
            days_to_add = 2  # Friday to Sunday
            current = current.replace(hour=22, minute=0, second=0, microsecond=0)
            current = current + timedelta(days=days_to_add)

        # Otherwise, advance by 1 hour
        else:
            current = current + timedelta(hours=1)

        iterations += 1

    if iterations >= max_iterations:
        raise ValueError(f"Could not find valid trading time after {max_iterations} iterations")

    return current


def get_last_valid_time(dt: datetime) -> datetime:
    """
    Get the most recent valid trading time before or at the given datetime

    Args:
        dt: Reference datetime

    Returns:
        Most recent valid trading datetime
    """
    if is_trading_hour(dt):
        return dt

    current = dt
    max_iterations = 1000  # Safety limit
    iterations = 0

    while not is_trading_hour(current) and iterations < max_iterations:
        weekday = current.weekday()

        # If Saturday, jump back to Friday 21:59 UTC
        if weekday == 5:
            days_to_subtract = 1
            current = current.replace(hour=21, minute=59, second=0, microsecond=0)
            current = current - timedelta(days=days_to_subtract)

        # If Sunday before 22:00, jump back to Friday 21:59
        elif weekday == 6 and current.hour < 22:
            days_to_subtract = 2  # Sunday to Friday
            current = current.replace(hour=21, minute=59, second=0, microsecond=0)
            current = current - timedelta(days=days_to_subtract)

        # If Friday after 22:00, set to Friday 21:59
        elif weekday == 4 and current.hour >= 22:
            current = current.replace(hour=21, minute=59, second=0, microsecond=0)

        # Otherwise, go back by 1 hour
        else:
            current = current - timedelta(hours=1)

        iterations += 1

    if iterations >= max_iterations:
        raise ValueError(f"Could not find valid trading time after {max_iterations} iterations")

    return current


def format_trading_session_info(dt: datetime) -> str:
    """
    Format datetime with trading session information

    Args:
        dt: Datetime to format

    Returns:
        Formatted string with trading status
    """
    trading_status = "TRADING" if is_trading_hour(dt) else "CLOSED"
    weekday_name = dt.strftime('%A')
    formatted_time = dt.strftime('%Y-%m-%d %H:%M:%S')

    return f"{formatted_time} UTC ({weekday_name}) [{trading_status}]"


def get_trading_hours_info() -> str:
    """
    Get information about Forex trading hours

    Returns:
        Description of trading hours
    """
    return """
📅 Forex Market Trading Hours (UTC):
   • Opens: Sunday 22:00 UTC
   • Closes: Friday 22:00 UTC
   • Trading: 24 hours/day, 5 days/week
   • Closed: Friday 22:00 - Sunday 22:00 UTC
"""
