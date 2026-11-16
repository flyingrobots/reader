"""Plain field-set errors before JSON dispatchers bind domain method arguments."""


def require_fields(request: dict[str, object], *, required: set[str], optional: set[str], label: str) -> None:
    """Report trusted contract labels and field names, never untrusted request keys."""
    if required <= request.keys() and not request.keys() - required - optional:
        return
    message = f'Expected {label} fields: {", ".join(sorted(required))}.'
    if optional:
        message += f' Optional fields: {", ".join(sorted(optional))}.'
    raise ValueError(message)
