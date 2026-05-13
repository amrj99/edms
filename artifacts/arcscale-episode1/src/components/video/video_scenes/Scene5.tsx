import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1800),
      setTimeout(() => setPhase(3), 3200),
      setTimeout(() => setPhase(4), 4800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.5, ease: 'easeInOut' }}
    >
      {/* Very subtle radial glow behind the center text */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: '60vw',
          height: '60vw',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(51,65,85,0.18) 0%, transparent 70%)',
        }}
        animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        transition={{ duration: 2 }}
      />

      {/* ArcScale wordmark */}
      <motion.div
        className="text-center z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className="text-[7vw] font-[300] text-white tracking-[0.15em]"
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.15em' }}
        >
          ArcScale
        </div>
        <div
          className="text-[3.5vw] font-[300] tracking-[0.5em] mt-[-0.5vw]"
          style={{ color: '#334155', letterSpacing: '0.5em' }}
        >
          EDMS
        </div>
      </motion.div>

      {/* Horizontal rule */}
      <motion.div
        className="z-10 mt-8 mb-8"
        initial={{ width: 0, opacity: 0 }}
        animate={phase >= 2 ? { width: '20vw', opacity: 1 } : {}}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        style={{ height: '1px', background: '#334155' }}
      />

      {/* Arabic tagline */}
      <motion.p
        className="text-[2vw] text-white/70 z-10 text-center"
        initial={{ opacity: 0, filter: 'blur(8px)' }}
        animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)' } : {}}
        transition={{ duration: 1 }}
      >
        توثيق الرحلة كاملة.
      </motion.p>

      <motion.p
        className="text-[1.4vw] text-white/35 z-10 text-center mt-3"
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 1 } : {}}
        transition={{ duration: 1 }}
      >
        بدون مبالغة. بدون تزييف.
      </motion.p>

      {/* Pulsing bottom accent dot */}
      <motion.div
        className="absolute bottom-[12%] left-[50%] -translate-x-[50%] w-1.5 h-1.5 rounded-full bg-[#334155] z-10"
        animate={phase >= 2 ? { opacity: [0.4, 0.9, 0.4], scale: [1, 1.3, 1] } : { opacity: 0 }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.div>
  );
}
