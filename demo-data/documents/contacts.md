# SafeSense — Contacts

| Area | Contact | When to involve |
| --- | --- | --- |
| Model accuracy | Meera Iyer, backend and models | any change to flood_best.pt or hazard thresholds |
| Mobile release | Priya Sharma, Flutter client | APK builds, API base URL, Play/APK distribution |
| Campus infrastructure | Arun Desai, university IT | VM access, firewall rules, LAN addressing |
| Security review | Dana Okafor, AppSec | anything touching JWT_SECRET or database credentials |

Escalation: model regressions go to Meera first; anything that exposes the
database or the .env file pages Dana immediately.
