from sqlalchemy.orm import Session
from sqlalchemy import select
from .models import Metric

def count_event(db: Session, event: str):
    m = db.execute(select(Metric).where(Metric.event == event)).scalar_one_or_none()
    if not m:
        m = Metric(event=event, count=1)
        db.add(m)
    else:
        m.count += 1
    db.commit()
