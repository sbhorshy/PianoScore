from pydantic import BaseModel
from typing import List, Optional


class Pitch(BaseModel):
    midiNote: int
    octave: int
    step: int


class Note(BaseModel):
    id: str
    pitch: Pitch
    duration: str  # 'whole', 'half', 'quarter', 'eighth', 'sixteenth'
    onset: float
    isRest: bool


class TimeSignature(BaseModel):
    numerator: int
    denominator: int


class KeySignature(BaseModel):
    fifths: int


class Measure(BaseModel):
    number: int
    timeSignature: TimeSignature
    keySignature: KeySignature
    startTime: float
    notes: List[Note]


class ScoreBase(BaseModel):
    title: str
    composer: Optional[str] = None
    tempo: int = 120
    measures: List[Measure]


class ScoreCreate(ScoreBase):
    pass


class Score(ScoreBase):
    id: str


class ScoreResponse(Score):
    pass
