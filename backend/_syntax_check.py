import ast, sys, os
os.chdir(os.path.dirname(__file__))
files = ["database.py", "models.py", "schemas.py", "auth.py", "sync.py", "main.py"]
ok = True
for f in files:
    src = open(f).read()
    try:
        ast.parse(src)
        print(f, "SYNTAX OK")
    except SyntaxError as e:
        print(f, "SYNTAX ERROR:", e)
        ok = False
sys.exit(0 if ok else 1)
