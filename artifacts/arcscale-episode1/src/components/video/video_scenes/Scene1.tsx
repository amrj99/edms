import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000), // Line 1
      setTimeout(() => setPhase(2), 4000), // Line 2
      setTimeout(() => setPhase(3), 7000), // Line 3
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center px-[10vw]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ clipPath: 'inset(100% 0 0 0)' }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Slow drifting geometric lines */}
      <div className="absolute inset-0 pointer-events-none opacity-10">
        {[...Array(5)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute h-[1px] bg-white w-[200vw]"
            initial={{ y: `${20 * i}vh`, x: '-50vw' }}
            animate={{ x: '0vw' }}
            transition={{ duration: 20 + i * 5, repeat: Infinity, ease: 'linear' }}
          />
        ))}
      </div>

      <div className="z-20 text-right space-y-4 pr-[5vw]">
        <motion.h1
          className="text-[5vw] font-[800] text-white tracking-tight"
          initial={{ opacity: 0, filter: 'blur(20px)', x: -20 }}
          animate={phase >= 1 ? { opacity: 1, filter: 'blur(0px)', x: 0 } : {}}
          transition={{ duration: 1.5, ease: 'circOut' }}
        >
          هذا ليس مشروعًا تجريبيًا.
        </motion.h1>
        <motion.h2
          className="text-[3.5vw] font-[600] text-white/70"
          initial={{ opacity: 0, filter: 'blur(10px)', x: -20 }}
          animate={phase >= 2 ? { opacity: 1, filter: 'blur(0px)', x: 0 } : {}}
          transition={{ duration: 1.5, ease: 'circOut' }}
        >
          هذا نظام حقيقي.
        </motion.h2>
        <motion.h3
          className="text-[2.5vw] font-[400] text-white/60"
          initial={{ opacity: 0, filter: 'blur(10px)', x: -20 }}
          animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)', x: 0 } : {}}
          transition={{ duration: 1.5, ease: 'circOut' }}
        >
          بُني من الصفر.
        </motion.h3>
      </div>
    </motion.div>
  );
}
