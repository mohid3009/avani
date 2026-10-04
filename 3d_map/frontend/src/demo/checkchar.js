// ISO 7064 MOD 37,36 check character: the same algorithm the backend uses (ulpin.py).
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function remainder(text) {
  let p = 36
  for (const c of text.toUpperCase()) {
    const i = ALNUM.indexOf(c)
    if (i < 0) continue
    let s = (i + p) % 36
    if (s === 0) s = 36
    p = (s * 2) % 37
  }
  return p
}

export const isValidChecked = (codeWithCheck) => remainder(codeWithCheck) === 2

// "<ulpin>-<c>" -> [ulpin, c]; c is null when there is no one-character suffix
export function splitCheck(code) {
  const text = (code || '').trim().toUpperCase()
  const i = text.lastIndexOf('-')
  const head = text.slice(0, i)
  const tail = text.slice(i + 1)
  return head && tail.length === 1 ? [head, tail] : [text, null]
}
