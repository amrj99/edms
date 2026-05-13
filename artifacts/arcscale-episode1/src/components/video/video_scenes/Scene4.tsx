import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const terminalLines = [
  { text: '$ docker ps', type: 'command', delay: 800 },
  { text: '', type: 'spacer', delay: 1400 },
  { text: 'edms_api       Up 14 days', type: 'output-ok', delay: 1700 },
  { text: 'edms_postgres  Up 14 days', type: 'output-ok', delay: 2300 },
  { text: '', type: 'spacer', delay: 3000 },
  { text: '$ curl /api/health', type: 'command', delay: 3400 },
  { text: '', type: 'spacer', delay: 4000 },
  { text: '{"status":"ok","database":"connected"}', type: 'output-json', delay: 4400 },
];

export function Scene4() {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [showCursor, setShowCursor] = useState(true);
  const [textPhase, setTextPhase] = useState(0);

  useEffect(() => {
    const lineTimers = terminalLines.map((line, i) =>
      setTimeout(() => setVisibleLines(i + 1), line.delay),
    );
    const textTimers = [
      setTimeout(() => setTextPhase(1), 2000),
      setTimeout(() => setTextPhase(2), 6000),
      setTimeout(() => setTextPhase(3), 10000),
    ];
    const cursorInterval = setInterval(() => setShowCursor((c) => !c), 500);
    return () => {
      lineTimers.forEach(clearTimeout);
      textTimers.forEach(clearTimeout);
      clearInterval(cursorInterval);
    };
  }, []);

  const getLineColor = (type: string) => {
    if (type === 'command') return 'text-white';
    if (type === 'output-ok') return 'text-white/60';
    if (type === 'output-json') return '#22c55e';
    return 'transparent';
  };

  return (
    <motion.div
      className="absolute inset-0 flex items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(20px)', scale: 0.97 }}
      transition={{ duration: 1 }}
    >
      {/* LEFT: Terminal */}
      <motion.div
        className="w-[55%] h-full flex items-center pl-[6vw]"
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1, ease: 'circOut' }}
      >
        <div
          className="w-full rounded-xl border border-[#334155]/60 overflow-hidden"
          style={{ background: '#0d0d14' }}
        >
          {/* Terminal header bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#334155]/40 bg-[#1a1a24]">
            {['#ef4444', '#f59e0b', '#22c55e'].map((color) => (
              <div key={color} className="w-3 h-3 rounded-full" style={{ background: color, opacity: 0.8 }} />
            ))}
            <span
              className="ml-3 text-white/30 text-[0.9vw]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              terminal — ssh arc@vps
            </span>
          </div>

          {/* Terminal body */}
          <div className="p-6 min-h-[28vh] space-y-1">
            {terminalLines.slice(0, visibleLines).map((line, i) => {
              if (line.type === 'spacer') return <div key={i} className="h-3" />;
              const color = getLineColor(line.type);
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center gap-2"
                >
                  {line.type === 'command' && (
                    <span className="text-white/40 select-none" style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1vw' }}>
                      $
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.1vw',
                      color: typeof color === 'string' && color.startsWith('#') ? color : undefined,
                    }}
                    className={typeof color === 'string' && !color.startsWith('#') ? color : ''}
                  >
                    {line.type === 'command' ? line.text.replace(/^\$ /, '') : line.text}
                  </span>
                  {line.type === 'output-ok' && (
                    <span className="text-[#22c55e] ml-2" style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1vw' }}>✓</span>
                  )}
                </motion.div>
              );
            })}
            {/* Blinking cursor */}
            <span
              className="inline-block w-[0.6vw] h-[1.5vw] bg-white/70 align-middle"
              style={{ opacity: showCursor ? 1 : 0, transition: 'opacity 0.1s' }}
            />
          </div>
        </div>
      </motion.div>

      {/* RIGHT: Arabic text */}
      <div className="w-[45%] flex flex-col items-end text-right pr-[6vw] space-y-8 z-20">
        <motion.p
          className="text-[3vw] font-[700] text-white leading-tight"
          initial={{ opacity: 0, filter: 'blur(12px)' }}
          animate={textPhase >= 1 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(12px)' }}
          transition={{ duration: 1.2 }}
        >
          الأنظمة الحقيقية
        </motion.p>
        <motion.p
          className="text-[2.2vw] font-[300] text-white/60"
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={textPhase >= 2 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 1.2 }}
        >
          لا تُبنى بالمظاهر...
        </motion.p>
        <motion.p
          className="text-[2.5vw] font-[600] text-white"
          initial={{ opacity: 0, y: 20 }}
          animate={textPhase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          بل بحل المشاكل الحقيقية.
        </motion.p>
      </div>
    </motion.div>
  );
}
