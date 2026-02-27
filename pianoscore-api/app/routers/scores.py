from fastapi import APIRouter, HTTPException
from typing import List
from app.models.score import ScoreCreate, ScoreResponse, Score

router = APIRouter()

# In-memory storage (replace with database)
scores_db: dict[str, Score] = {}


@router.get("/", response_model=List[ScoreResponse])
async def get_scores():
    """Get all scores"""
    return list(scores_db.values())


@router.get("/{score_id}", response_model=ScoreResponse)
async def get_score(score_id: str):
    """Get a specific score"""
    if score_id not in scores_db:
        raise HTTPException(status_code=404, detail="Score not found")
    return scores_db[score_id]


@router.post("/", response_model=ScoreResponse)
async def create_score(score: ScoreCreate):
    """Create a new score"""
    new_score = Score(
        id=str(len(scores_db) + 1),
        **score.dict()
    )
    scores_db[new_score.id] = new_score
    return new_score


@router.put("/{score_id}", response_model=ScoreResponse)
async def update_score(score_id: str, score: ScoreCreate):
    """Update a score"""
    if score_id not in scores_db:
        raise HTTPException(status_code=404, detail="Score not found")
    
    updated_score = Score(id=score_id, **score.dict())
    scores_db[score_id] = updated_score
    return updated_score


@router.delete("/{score_id}")
async def delete_score(score_id: str):
    """Delete a score"""
    if score_id not in scores_db:
        raise HTTPException(status_code=404, detail="Score not found")
    
    del scores_db[score_id]
    return {"message": "Score deleted successfully"}
