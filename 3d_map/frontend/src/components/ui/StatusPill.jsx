const tones = {
  verified: 'bg-[#E3F1EA] text-[#0F5442]',
  review: 'bg-amberbg text-[#8A6410]',
  info: 'bg-[#E8EEFB] text-[#2E3F9E]',
}

export default function StatusPill({ variant = 'info', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${tones[variant] || tones.info}`}
    >
      {children}
    </span>
  )
}