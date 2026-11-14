"""Lunar OPS server.

Run from the repository root (demo mode uses SYNTHETIC ephemeris, see backend/calc/ephemeris.py):
    LUNAR_OPS_DEMO=1 .venv/bin/uvicorn backend.main:app --reload
Interactive API docs: http://127.0.0.1:8000/docs
"""
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.api.errors import ApiError, error_body
from backend.api.routes import router

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"

app = FastAPI(title="Lunar OPS", description="Prototype: potential sunlight and geometric Earth visibility at lunar south pole sites")
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.include_router(router)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content=error_body(exc.code, exc.message))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0]
    where = ".".join(str(p) for p in first["loc"] if p != "body")
    return JSONResponse(status_code=422, content=error_body("bad_params", f"{where}: {first['msg']}"))


if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
else:

    @app.get("/")
    def root():
        return {"message": "Lunar OPS API is running. No frontend/ folder yet. See /docs."}
