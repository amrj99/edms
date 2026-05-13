import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);
  const [count1, setCount1] = useState(0);
  const [count2, setCount2] = useState(0);
  const [count3, setCount3] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 4500),
      setTimeout(() => setPhase(4), 7000),
      setTimeout(() => setPhase(5), 10000),
      setTimeout(() => setPhase(6), 13000),
      setTimeout(() => setPhase(7), 16000),
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  useEffect(() => {
    if (phase < 2) return;
    let v1 = 0, v2 = 0, v3 = 0;
    const interval = setInterval(() => {
      v1 = Math.min(v1 + 7, 284);
      v2 = Math.min(v2 + 2, 47);
      v3 = Math.min(v3 + 1, 12);
      setCount1(v1);
      setCount2(v2);
      setCount3(v3);
      if (v1 === 284 && v2 === 47 && v3 === 12) clearInterval(interval);
    }, 30);
    return () => clearInterval(interval);
  }, [phase]);

  const chips = ['متعدد المستأجرين', 'آمن', 'قابل للتوسع'];
  const tabs = ['المستندات', 'المشاريع', 'المراسلات'];

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-between px-[6vw]"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.05, filter: 'blur(12px)' }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background subtle grid dots */}
      <div
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: 'radial-gradient(circle, #334155 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* LEFT: Dashboard Mockup */}
      <motion.div
        className="w-[44%] flex flex-col gap-4 z-20"
        initial={{ opacity: 0, x: -40 }}
        animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -40 }}
        transition={{ duration: 1, ease: 'circOut' }}
      >
        {/* Tabs */}
        <div className="flex gap-2 mb-2 flex-row-reverse">
          {tabs.map((tab, i) => (
            <motion.div
              key={tab}
              className="px-4 py-1.5 rounded-md text-[1.1vw] border"
              style={{
                background: i === 0 ? '#22c55e18' : '#1a1a24',
                borderColor: i === 0 ? '#22c55e60' : '#334155',
                color: i === 0 ? '#22c55e' : 'rgba(255,255,255,0.5)',
              }}
              initial={{ opacity: 0, y: 10 }}
              animate={phase >= 1 ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.15 }}
            >
              {tab}
            </motion.div>
          ))}
        </div>

        {/* Stat Cards */}
        {[
          { label: 'مستند', value: count1, unit: '' },
          { label: 'مشروع', value: count2, unit: '' },
          { label: 'مستخدم', value: count3, unit: '' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            className="flex items-center justify-between px-6 py-4 rounded-xl border border-[#334155] bg-[#1a1a24]"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: i * 0.2, ease: 'circOut' }}
          >
            <span className="text-white/50 text-[1.1vw]">{stat.label}</span>
            <span
              className="text-[2.5vw] font-bold tabular-nums"
              style={{ color: i === 0 ? '#22c55e' : 'white' }}
            >
              {stat.value}
            </span>
          </motion.div>
        ))}

        {/* Status bar */}
        <motion.div
          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#334155]/50 bg-[#0f1117]"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : {}}
          transition={{ duration: 0.8 }}
        >
          <motion.div
            className="w-2 h-2 rounded-full bg-[#22c55e]"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span className="text-[1vw] text-white/40">النظام يعمل — جميع الخدمات متاحة</span>
        </motion.div>
      </motion.div>

      {/* RIGHT: Text + Chips */}
      <div className="w-[50%] flex flex-col items-end z-20 text-right space-y-6 pr-[2vw]">
        <motion.div
          className="text-[5vw] font-[700] text-white leading-tight tracking-tight"
          style={{ fontFamily: 'var(--font-display)' }}
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          ArcScale
          <span className="block text-[4vw] font-[300] text-white/70 tracking-widest">EDMS</span>
        </motion.div>

        <motion.p
          className="text-[2vw] text-white/70 font-[400]"
          initial={{ opacity: 0, filter: 'blur(8px)' }}
          animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(8px)' }}
          transition={{ duration: 1 }}
        >
          نظام إدارة مستندات هندسية
        </motion.p>

        <div className="flex flex-row-reverse flex-wrap gap-3">
          {chips.map((chip, i) => (
            <motion.div
              key={chip}
              className="px-5 py-2 rounded-full border border-[#334155] text-[1.3vw] text-white/70"
              style={{ background: '#1a1a24' }}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={phase >= 4 + i ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.5, type: 'spring', stiffness: 300, damping: 20 }}
            >
              {chip}
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
