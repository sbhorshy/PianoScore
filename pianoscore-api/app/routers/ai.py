from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
import tempfile
import os

from app.services.ai_recognition import AIRecognitionService
from app.models.score import ScoreCreate, ScoreResponse

router = APIRouter()
ai_service = AIRecognitionService()


@router.post("/transcribe")
async def transcribe_sheet_music(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """
    Upload PDF or image of sheet music and convert to MusicXML using AI
    """
    # Validate file type
    allowed_types = ["application/pdf", "image/png", "image/jpeg", "image/jpg"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {allowed_types}"
        )

    # Save uploaded file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Process with AI
        result = await ai_service.transcribe(tmp_path)
        
        # Clean up temp file in background
        background_tasks.add_task(os.unlink, tmp_path)
        
        return {
            "status": "success",
            "score": result,
            "message": "Sheet music transcribed successfully"
        }
    
    except Exception as e:
        # Clean up on error
        os.unlink(tmp_path)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/recognize-notes")
async def recognize_notes(
    file: UploadFile = File(...),
):
    """
    Recognize individual notes from an image (for debugging)
    """
    # TODO: Implement note-level recognition
    return {"status": "not implemented yet"}


@router.get("/models/status")
async def get_model_status():
    """
    Get status of AI models
    """
    return {
        "staff_detection": ai_service.staff_model_loaded,
        "note_recognition": ai_service.note_model_loaded,
        "device": ai_service.device,
    }
