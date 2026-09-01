"""
caregiver-marketplace/backend/app/services/notification_service.py
Send patient ID to family members via Email (SMTP) and optionally SMS (Twilio).
"""
import os
import asyncio
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


async def send_patient_id_email(
    family_email: str,
    family_name: str,
    caregiver_name: str,
    elder_name: str,
    patient_id: str,
    booking_id: str,
) -> bool:
    """
    Send the patient ID to the family member via email.
    Returns True on success, False on failure.
    """
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("SMTP_FROM_EMAIL", smtp_user)

    if not smtp_user or not smtp_pass:
        print("[WARN] notification_service: SMTP credentials not configured, skipping email")
        return False

    marketplace_url = os.getenv("MARKETPLACE_FRONTEND_URL", "http://localhost:5179")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"🛡️ SecureElderCare — Your Patient ID: {patient_id}"
    msg["From"] = from_email
    msg["To"] = family_email

    html = f"""
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;
                padding: 0; background: #f8fafc; border-radius: 16px; overflow: hidden;">

      <!-- Header -->
      <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 32px 24px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">
          🛡️ SecureElderCare
        </h1>
        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">
          Booking Confirmed
        </p>
      </div>

      <!-- Body -->
      <div style="padding: 32px 24px;">
        <p style="color: #334155; font-size: 16px; margin: 0 0 20px;">
          Dear <strong>{family_name}</strong>,
        </p>
        <p style="color: #475569; font-size: 14px; margin: 0 0 24px; line-height: 1.6;">
          Your caregiver booking has been confirmed! Here are the details:
        </p>

        <!-- Details Card -->
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px;
                    padding: 24px; margin: 0 0 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Booking ID</td>
              <td style="padding: 8px 0; color: #1e293b; font-size: 13px; font-weight: 600; text-align: right;">
                {booking_id}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px;">👩‍⚕️ Caregiver</td>
              <td style="padding: 8px 0; color: #1e293b; font-size: 13px; font-weight: 600; text-align: right;">
                {caregiver_name}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 13px;">👴 Elder</td>
              <td style="padding: 8px 0; color: #1e293b; font-size: 13px; font-weight: 600; text-align: right;">
                {elder_name}
              </td>
            </tr>
          </table>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;" />

          <div style="text-align: center;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 8px; text-transform: uppercase;
                      letter-spacing: 1px;">
              Your Patient ID
            </p>
            <p style="font-size: 32px; font-weight: 800; color: #4f46e5; margin: 0;
                      letter-spacing: 3px; font-family: monospace;">
              {patient_id}
            </p>
          </div>
        </div>

        <!-- CTA -->
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="{marketplace_url}/monitor"
             style="display: inline-block; background: linear-gradient(135deg, #4f46e5, #7c3aed);
                    color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none;
                    font-weight: 600; font-size: 14px; box-shadow: 0 4px 12px rgba(79,70,229,0.3);">
            🖥️ Open Monitoring Dashboard
          </a>
        </div>

        <p style="color: #94a3b8; font-size: 12px; text-align: center; line-height: 1.5; margin: 0;">
          Enter your Patient ID on the monitoring page to see live camera feeds,
          anomaly alerts, and schedule compliance for your elder.
        </p>
      </div>

      <!-- Footer -->
      <div style="background: #f1f5f9; padding: 16px 24px; text-align: center;">
        <p style="color: #94a3b8; font-size: 11px; margin: 0;">
          SecureElderCare — AI-Powered Elder Care Monitoring
        </p>
      </div>
    </div>
    """

    msg.attach(MIMEText(html, "html"))

    def _send():
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)

    try:
        await asyncio.to_thread(_send)
        print(f"[INFO] Patient ID email sent to {family_email}")
        return True
    except Exception as e:
        print(f"[ERROR] notification_service email failed: {repr(e)}")
        return False


async def send_patient_id_sms(
    phone: str,
    patient_id: str,
    elder_name: str,
    caregiver_name: str,
) -> bool:
    """
    Send the patient ID via SMS using Twilio.
    Returns True on success, False on failure.
    """
    sid = os.getenv("TWILIO_SID", "")
    auth = os.getenv("TWILIO_AUTH", "")
    from_phone = os.getenv("TWILIO_PHONE", "")

    if not sid or not auth or not from_phone:
        print("[WARN] notification_service: Twilio credentials not configured, skipping SMS")
        return False

    try:
        from twilio.rest import Client
        client = Client(sid, auth)
        client.messages.create(
            body=(
                f"🛡️ SecureElderCare\n\n"
                f"Booking confirmed!\n"
                f"👩‍⚕️ Caregiver: {caregiver_name}\n"
                f"👴 Elder: {elder_name}\n"
                f"🔑 Patient ID: {patient_id}\n\n"
                f"Use this ID at your monitoring dashboard to watch live monitoring."
            ),
            from_=from_phone,
            to=phone,
        )
        print(f"[INFO] Patient ID SMS sent to {phone}")
        return True
    except ImportError:
        print("[WARN] twilio package not installed — SMS not sent. Install with: pip install twilio")
        return False
    except Exception as e:
        print(f"[ERROR] notification_service SMS failed: {repr(e)}")
        return False
