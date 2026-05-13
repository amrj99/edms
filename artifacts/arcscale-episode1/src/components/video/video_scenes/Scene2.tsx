import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000), // Header
      setTimeout(() => setPhase(2), 2500), // Diagram Start
      setTimeout(() => setPhase(3), 5000), // Bullet 1
      setTimeout(() => setPhase(4), 7000), // Bullet 2
      setTimeout(() => setPhase(5), 9000), // Bullet 3
      setTimeout(() => setPhase(6), 11000), // Bullet 4 (Chaos)
      setTimeout(() => setPhase(7), 16000), // Exit start
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const bullets = [
    { text: 'المستندات', phase: 3 },
    { text: 'الموافقات', phase: 4 },
    { text: 'المراسلات', phase: 5 },
    { text: 'الفوضى.', phase: 6 },
  ];

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ clipPath: 'inset(100% 0 0 0)' }}
      animate={{ clipPath: 'inset(0% 0 0 0)' }}
      exit={{ scale: 1.1, opacity: 0, filter: 'blur(20px)' }}
      transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Background Gradient Shifts */}
      <motion.div
        className="absolute inset-0 opacity-20 bg-gradient-to-br from-[#1a1a24] to-[#0a0a0f]"
        animate={{
          backgroundPosition: ['0% 0%', '100% 100%'],
        }}
        transition={{ duration: 20, repeat: Infinity, repeatType: 'reverse' }}
      />

      {/* LEFT: Bullets */}
      <div className="w-[40%] flex flex-col items-start z-20 space-y-8 pl-[5vw]">
        {bullets.map((b, i) => (
          <motion.div
            key={i}
            className="flex items-center space-x-4 space-x-reverse"
            initial={{ opacity: 0, x: -30 }}
            animate={phase >= b.phase ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, ease: 'circOut' }}
          >
            <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
            <span className="text-[3vw] font-bold text-white/90">{b.text}</span>
          </motion.div>
        ))}
      </div>

      {/* RIGHT/CENTER: Diagram & Header */}
      <div className="w-[50%] relative flex flex-col items-end z-20">
        <motion.h2
          className="text-[2.5vw] font-semibold text-white mb-12 text-right"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1 }}
        >
          الشركات الهندسية تغرق في:
        </motion.h2>

        {/* Diagram Area */}
        <div className="relative w-full h-[40vh]">
          {/* Companies row */}
          <div className="flex justify-between w-full absolute top-0">
            {[1, 2, 3].map((num, i) => (
              <motion.div
                key={num}
                className="w-[8vw] h-[6vh] border-2 border-[#334155] bg-[#1a1a24] flex items-center justify-center rounded text-white/70 text-[1.2vw]"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={phase >= 2 ? { opacity: 1, scale: 1 } : {}}
                transition={{ duration: 0.5, delay: i * 0.2 }}
              >
                شركة {num}
              </motion.div>
            ))}
          </div>

          {/* System Box */}
          <motion.div
            className="absolute top-[18vh] left-[50%] -translate-x-[50%] w-[12vw] h-[8vh] border-2 border-[#334155] bg-[#1a1a24] flex items-center justify-center rounded text-white/90 font-bold text-[1.5vw]"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={phase >= 2 ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5, delay: 1 }}
          >
            النظام
          </motion.div>

          {/* DB Box */}
          <motion.div
            className="absolute bottom-0 left-[50%] -translate-x-[50%] w-[10vw] h-[6vh] border-2 border-[#334155] bg-[#1a1a24] flex items-center justify-center rounded text-white/70 text-[1.2vw]"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={phase >= 2 ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5, delay: 1.5 }}
          >
            قاعدة البيانات
          </motion.div>

          {/* SVG Arrows */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: -1 }}>
            {/* Top to System */}
            {[10, 50, 90].map((leftPos, i) => (
              <motion.path
                key={i}
                d={`M ${leftPos}% 15% Q ${leftPos}% 30% 50% 45%`}
                fill="none"
                stroke="#334155"
                strokeWidth="2"
                initial={{ pathLength: 0 }}
                animate={phase >= 2 ? { pathLength: 1 } : {}}
                transition={{ duration: 1, delay: 0.6 + i * 0.2, ease: "easeInOut" }}
              />
            ))}
            {/* System to DB */}
            <motion.path
              d="M 50% 65% L 50% 85%"
              fill="none"
              stroke="#334155"
              strokeWidth="2"
              initial={{ pathLength: 0 }}
              animate={phase >= 2 ? { pathLength: 1 } : {}}
              transition={{ duration: 0.8, delay: 1.8, ease: "easeInOut" }}
            />
          </svg>
        </div>
      </div>
    </motion.div>
  );
}
