from fastapi import APIRouter

router = APIRouter()


@router.get("/me")
async def get_current_user():
    """Get current user info"""
    return {"id": "1", "name": "Test User"}


@router.post("/login")
async def login():
    """User login"""
    return {"token": "test_token"}


@router.get("/{user_id}/progress")
async def get_user_progress(user_id: str):
    """Get user's practice progress"""
    return {
        "user_id": user_id,
        "total_practice_time": 3600,
        "scores_completed": 5,
        "accuracy": 85.5,
    }
