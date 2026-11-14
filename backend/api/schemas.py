from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_validator


class Scenario(BaseModel):
    site_id: str
    start: datetime
    days: int = Field(ge=1, le=366)
    step_min: int = Field(default=30, ge=10, le=120)
    use_terrain: bool = True

    @field_validator("start")
    @classmethod
    def to_naive_utc(cls, v):
        # naive input is treated as UTC
        if v.tzinfo is not None:
            v = v.astimezone(timezone.utc).replace(tzinfo=None)
        return v


class CompareRequest(BaseModel):
    a: Scenario
    b: Scenario
