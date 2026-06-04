import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import cashclipIcon from '@assets/cashclip/assets/images/icon.png';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1600),
      setTimeout(() => setPhase(4), 3500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center z-20"
      initial={{ opacity: 0, x: '20vw' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '-20vw', filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        className="w-[20vw] h-[20vw] bg-emerald-500/20 rounded-[4vw] shadow-[0_0_50px_rgba(16,185,129,0.3)] flex items-center justify-center overflow-hidden mb-[4vw] relative"
        initial={{ scale: 0, rotate: -20 }}
        animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -20 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <img src={cashclipIcon} alt="CashClip" className="w-[80%] h-[80%] object-contain" />
      </motion.div>

      <motion.h2
        className="text-[6vw] font-['Plus_Jakarta_Sans'] font-bold text-white mb-[2vw]"
        initial={{ opacity: 0, y: 30 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        transition={{ duration: 0.6 }}
      >
        CashClip
      </motion.h2>

      <motion.div
        className="flex gap-[2vw] text-[3vw] text-emerald-400 font-semibold"
        initial={{ opacity: 0 }}
        animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
      >
        {['Watch,', 'Earn,', 'Repeat.'].map((word, i) => (
          <motion.span
            key={word}
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ delay: i * 0.15, duration: 0.5 }}
          >
            {word}
          </motion.span>
        ))}
      </motion.div>
    </motion.div>
  );
}
