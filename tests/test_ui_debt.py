"""Custom tokens, hand-written CSS and hard-coded inline styles only go down. Lower a ceiling when you remove some."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('ui_debt', Path(__file__).resolve().parents[1] / 'scripts/ui_debt.py')
ui_debt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui_debt)
CEILINGS = {'custom_tokens': 33, 'css_rules': 1367, 'hard_coded_inline_styles': 0}


def test_ui_debt_only_goes_down():
    result = ui_debt.count()
    for name, ceiling in CEILINGS.items():
        assert result[name] <= ceiling, (name, result[name], {k: v for k, v in result['inline'].items()} if 'inline' in name else '')
