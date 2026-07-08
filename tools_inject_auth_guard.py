from pathlib import Path

root = Path(r'c:\Users\RIVERSON\Desktop\nicko')
files = [
    root / 'index.html',
    root / 'dashboard.html',
    root / 'wallet.html',
    root / 'deposit.html',
    root / 'withdraw.html',
    root / 'profile.html',
    root / 'tickets.html',
    root / 'history.html',
    root / 'results.html',
    root / 'settings.html',
    root / 'login-register' / 'login.html',
    root / 'login-register' / 'register.html',
    root / 'login-register' / 'forgot-password.html',
]
files += sorted((root / 'jeux').glob('*.html'))

for path in files:
    if not path.exists():
        continue
    text = path.read_text(encoding='utf-8')
    updated = text
    if 'id="authHeaderActions"' not in updated:
        updated = updated.replace('<div class="header-actions">', '<div class="header-actions">\n        <div id="authHeaderActions"></div>', 1)
    if 'auth-guard.js' not in updated:
        if 'src="js/auth.js"' in updated:
            updated = updated.replace('<script src="js/auth.js"></script>', '<script src="js/auth.js"></script>\n  <script src="js/auth-guard.js"></script>', 1)
        elif 'src="../js/auth.js"' in updated:
            updated = updated.replace('<script src="../js/auth.js"></script>', '<script src="../js/auth.js"></script>\n  <script src="../js/auth-guard.js"></script>', 1)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

print(f'updated {len(files)} files')
