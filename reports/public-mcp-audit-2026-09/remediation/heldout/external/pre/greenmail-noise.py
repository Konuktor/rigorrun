#!/usr/bin/env python3
"""Held-out pre-state: three unrelated messages and one earlier 'Rota change' with a different body, into the local GreenMail only."""
import smtplib
from email.message import EmailMessage
notes = [("Standup moved", "Standup is at ten."), ("Lunch order", "Pizza again."), ("Rota change", "An earlier, different note."), ("Badge reminder", "Wear your badge.")]
with smtplib.SMTP("127.0.0.1", 3025, timeout=20) as smtp:
    for subject, body in notes:
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = "noise@example.test", "qa@example.test", subject
        message.set_content(body)
        smtp.send_message(message)
print("greenmail-noise: 4 messages delivered to qa@example.test")
