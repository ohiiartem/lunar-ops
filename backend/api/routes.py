from fastapi import APIRouter

from backend.api import service
from backend.api.errors import ApiError
from backend.api.schemas import CompareRequest, Scenario
from backend.api.summary import summarize

router = APIRouter(prefix="/api")

DELTA_KEYS = ("light_hours", "earth_visible_hours", "both_hours", "longest_darkness_hours")


@router.get("/health")
def get_health():
    return service.health()


@router.get("/sites")
def get_sites():
    return service.list_sites()


@router.post("/analyze")
def post_analyze(sc: Scenario):
    return service.analyze(sc)


@router.post("/timeseries")
def post_timeseries(sc: Scenario):
    return service.timeseries(sc)


@router.post("/compare")
def post_compare(req: CompareRequest):
    if req.a.days != req.b.days or req.a.step_min != req.b.step_min:
        raise ApiError(422, "incompatible_scenarios", "Scenarios a and b must have the same days and step_min")
    a, b = service.analyze(req.a), service.analyze(req.b)
    delta = {k: round(b[k] - a[k], 1) for k in DELTA_KEYS}
    return {"a": a, "b": b, "delta": delta, "summary": summarize(delta)}
