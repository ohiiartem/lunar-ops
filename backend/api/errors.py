class ApiError(Exception):
    """Error with an HTTP status and a machine-readable code (see docs/contracts.md)."""

    def __init__(self, status, code, message):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(message)


def error_body(code, message):
    return {"error": {"code": code, "message": message}}
