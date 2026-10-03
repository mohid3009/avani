"""Run: python test_check_char.py. Every single wrong character must be caught."""
from app.ulpin import is_valid, split_check, with_check

A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
code = with_check("TN-07-4821-9034-7756-F3-U2")
assert is_valid(code) and split_check(code) == ("TN-07-4821-9034-7756-F3-U2", code[-1])
body = [i for i, c in enumerate(code) if c in A]
for i in body:
    for ch in A:
        if ch != code[i]:
            assert not is_valid(code[:i] + ch + code[i + 1:]), (i, ch)
print("ok:", code)
