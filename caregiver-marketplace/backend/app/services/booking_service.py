"""
caregiver-marketplace/backend/app/services/booking_service.py
Handles booking creation, patient ID generation, and booking lifecycle.
"""
import random
import string
from datetime import datetime, timezone
from bson import ObjectId

from shared.backend.config.database import get_db


def _generate_patient_id() -> str:
    """Generate a unique patient ID like PT-2026-A3F7."""
    year = datetime.now().year
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"PT-{year}-{suffix}"


class BookingService:

    def _bookings(self):
        return get_db()["bookings"]

    def _users(self):
        return get_db()["users"]

    async def create_booking(self, family_user_id: str, payload: dict) -> dict:
        """
        Create a new booking and generate a patient ID.
        Returns the booking document with patient_id.
        """
        # Look up caregiver name
        caregiver = self._users().find_one(
            {"_id": ObjectId(payload["caregiver_user_id"])},
            {"name": 1},
        )
        caregiver_name = caregiver["name"] if caregiver else "Unknown"

        # Look up family member info
        family = self._users().find_one(
            {"_id": ObjectId(family_user_id)},
            {"name": 1, "email": 1, "contact_number": 1},
        )

        # Generate unique patient ID
        patient_id = _generate_patient_id()
        # Ensure uniqueness
        while self._bookings().find_one({"patient_id": patient_id}):
            patient_id = _generate_patient_id()

        now = datetime.now(timezone.utc)

        # Calculate simple cost estimate
        schedule = payload.get("schedule", {})
        days_per_week = len(schedule.get("days", []))
        # Rough estimate: hours per day × days per week × 4 weeks
        try:
            start_h, start_m = map(int, schedule.get("start_time", "09:00").split(":"))
            end_h, end_m = map(int, schedule.get("end_time", "17:00").split(":"))
            hours_per_day = (end_h + end_m / 60) - (start_h + start_m / 60)
        except (ValueError, AttributeError):
            hours_per_day = 8

        hourly_rate = 0
        if caregiver:
            cg_full = self._users().find_one({"_id": ObjectId(payload["caregiver_user_id"])}, {"hourly_rate": 1})
            hourly_rate = cg_full.get("hourly_rate", 0) if cg_full else 0

        total_hours = hours_per_day * days_per_week * 4  # 4-week estimate
        total_amount = total_hours * hourly_rate

        booking_doc = {
            "booking_id": f"BK-{now.strftime('%Y%m%d')}-{patient_id.split('-')[-1]}",
            "patient_id": patient_id,
            "family_user_id": family_user_id,
            "family_name": family["name"] if family else "Unknown",
            "family_email": family["email"] if family else "",
            "family_phone": family.get("contact_number", "") if family else "",
            "caregiver_user_id": payload["caregiver_user_id"],
            "caregiver_name": caregiver_name,
            "elder": payload.get("elder", {}),
            "schedule": schedule,
            "hourly_rate": hourly_rate,
            "total_hours": round(total_hours, 1),
            "total_amount": round(total_amount, 2),
            "notes": payload.get("notes", ""),
            "status": "confirmed",
            "notify_email": payload.get("notify_email", True),
            "notify_sms": payload.get("notify_sms", False),
            "patient_id_sent_via": [],
            "created_at": now,
            "updated_at": now,
        }

        self._bookings().insert_one(booking_doc)

        return booking_doc

    async def get_bookings_for_user(self, user_id: str, role: str) -> list[dict]:
        """Get all bookings for a family member or caregiver."""
        if role == "caregiver":
            query = {"caregiver_user_id": user_id}
        else:
            query = {"family_user_id": user_id}

        try:
            docs = list(
                self._bookings()
                .find(query, {"_id": 0})
                .sort("created_at", -1)
                .limit(50)
            )
            for doc in docs:
                if "created_at" in doc:
                    doc["created_at"] = str(doc["created_at"])
                if "updated_at" in doc:
                    doc["updated_at"] = str(doc["updated_at"])
            return docs
        except Exception as e:
            print(f"[ERROR] booking_service.get_for_user: {repr(e)}")
            return []

    async def get_booking_by_id(self, booking_id: str) -> dict | None:
        """Get a single booking by its booking_id."""
        try:
            doc = self._bookings().find_one({"booking_id": booking_id}, {"_id": 0})
            if doc:
                if "created_at" in doc:
                    doc["created_at"] = str(doc["created_at"])
                if "updated_at" in doc:
                    doc["updated_at"] = str(doc["updated_at"])
            return doc
        except Exception as e:
            print(f"[ERROR] booking_service.get_by_id: {repr(e)}")
            return None

    async def get_booking_by_patient_id(self, patient_id: str) -> dict | None:
        """Look up a booking by its patient ID."""
        try:
            doc = self._bookings().find_one({"patient_id": patient_id}, {"_id": 0})
            if doc:
                if "created_at" in doc:
                    doc["created_at"] = str(doc["created_at"])
                if "updated_at" in doc:
                    doc["updated_at"] = str(doc["updated_at"])
            return doc
        except Exception as e:
            print(f"[ERROR] booking_service.get_by_patient_id: {repr(e)}")
            return None

    async def cancel_booking(self, booking_id: str, user_id: str) -> bool:
        """Cancel a booking (only by the family member who created it)."""
        try:
            result = self._bookings().update_one(
                {"booking_id": booking_id, "family_user_id": user_id, "status": "confirmed"},
                {"$set": {"status": "cancelled", "updated_at": datetime.now(timezone.utc)}},
            )
            return result.modified_count > 0
        except Exception as e:
            print(f"[ERROR] booking_service.cancel: {repr(e)}")
            return False

    async def mark_patient_id_sent(self, booking_id: str, via: str) -> None:
        """Record that the patient ID was sent via a channel (email/sms)."""
        try:
            self._bookings().update_one(
                {"booking_id": booking_id},
                {"$addToSet": {"patient_id_sent_via": via}},
            )
        except Exception as e:
            print(f"[ERROR] booking_service.mark_sent: {repr(e)}")
