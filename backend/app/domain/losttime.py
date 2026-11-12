"""Lost-time reasons (roadmap #5): why a supervisor's sheet has unallocated hours, and what
disrupted a day. The foreman-delay survey idea built into the push: one optional pick, so ZIDLE
hours become evidence by cause and by the party responsible."""

from __future__ import annotations

from pydantic import BaseModel


class Cause(BaseModel):
    id: str
    label: str
    party: str  # who is responsible: Client / consultant, Contractor, Supplier, Neutral


CAUSES = [
    Cause(id="rain", label="Rain or weather", party="Neutral"),
    Cause(id="concrete", label="Waiting for concrete", party="Supplier"),
    Cause(id="materials", label="No materials", party="Contractor"),
    Cause(id="drawings", label="No drawings or instructions", party="Client / consultant"),
    Cause(id="plant", label="Plant breakdown", party="Contractor"),
    Cause(id="power", label="Power cut", party="Neutral"),
    Cause(id="instruction", label="Client or consultant instruction", party="Client / consultant"),
    Cause(id="other", label="Other (see note)", party="Not stated"),
]
CAUSE_IDS = {c.id for c in CAUSES}
