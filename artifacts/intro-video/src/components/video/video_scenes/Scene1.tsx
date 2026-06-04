import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200), // First text
      setTimeout(() => setPhase(2), 800), // Main text stagger
      setTimeout(() => setPhase(3), 1800), // Subtext
      setTimeout(() => setPhase(4), 3000), // Exit start
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const headline = "Two Worlds.".split('');

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
      transition={{ duration: 0.8 }}
    >
      {/* Decorative large numbers/letters in background */}
      <motion.div 
        className="absolute left-[10vw] top-[10vh] text-[30vw] font-black text-white/5 select-none"
        initial={{ y: 100, opacity: 0 }}
        animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 100, opacity: 0 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        01
      </motion.div>

      <div className="relative z-10 w-full flex flex-col items-center">
        {/* Animated line/badge */}
        <motion.div 
          className="flex items-center gap-4 mb-8"
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="h-[1px] w-[5vw] bg-sky-400" />
          <p className="text-[1.5vw] text-sky-400 font-semibold tracking-[0.3em] uppercase">
            One Team
          </p>
          <div className="h-[1px] w-[5vw] bg-sky-400" />
        </motion.div>

        {/* Character stagger headline */}
        <div className="overflow-hidden flex pt-4 pb-2">
          {headline.map((char, i) => (
            <motion.span
              key={i}
              className="text-[10vw] font-black leading-none text-white tracking-tighter"
              style={{ display: 'inline-block' }}
              initial={{ y: "120%", rotateX: 45, opacity: 0 }}
              animate={phase >= 2 ? { y: "0%", rotateX: 0, opacity: 1 } : { y: "120%", rotateX: 45, opacity: 0 }}
              transition={{ 
                duration: 0.8, 
                ease: [0.16, 1, 0.3, 1],
                delay: phase >= 2 ? i * 0.05 : 0 
              }}
            >
              {char === " " ? "\u00A0" : char}
            </motion.span>
          ))}
        </div>

        <motion.p
          className="mt-6 text-[1.8vw] text-slate-400 font-light tracking-wide"
          initial={{ opacity: 0, filter: 'blur(10px)', y: 20 }}
          animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)', y: 0 } : { opacity: 0, filter: 'blur(10px)', y: 20 }}
          transition={{ duration: 0.8 }}
        >
          Shared Foundation. Boundless Scale.
        </motion.p>
      </div>

      {/* Wipe element for transition out */}
      <motion.div 
        className="absolute inset-0 bg-emerald-500 z-50 origin-left"
        initial={{ scaleX: 0 }}
        animate={phase >= 4 ? { scaleX: 1 } : { scaleX: 0 }}
        transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
      />
    </motion.div>
  );
}