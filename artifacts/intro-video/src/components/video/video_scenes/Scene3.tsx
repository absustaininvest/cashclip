import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import abLogo from '@assets/absustain/public/logo-transparent.png';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1400),
      setTimeout(() => setPhase(4), 2000),
      setTimeout(() => setPhase(5), 3800),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex z-20 overflow-hidden bg-slate-900"
      initial={{ x: '-100%' }}
      animate={{ x: 0 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
    >
      {/* Corporate abstract background */}
      <motion.div 
        className="absolute inset-0 opacity-30"
        initial={{ opacity: 0 }}
        animate={phase >= 1 ? { opacity: 0.3 } : { opacity: 0 }}
        transition={{ duration: 2 }}
      >
        <div className="absolute top-0 right-0 w-[70vw] h-[100vh] bg-gradient-to-l from-blue-900/50 to-transparent transform skew-x-12 translate-x-20" />
        <div className="absolute bottom-0 left-0 w-[50vw] h-[50vh] bg-gradient-to-t from-indigo-900/40 to-transparent" />
      </motion.div>

      <div className="w-[45%] h-full relative flex items-center justify-center bg-white/5 backdrop-blur-sm border-r border-white/10">
        <motion.div
          className="w-[25vw] relative z-10"
          initial={{ opacity: 0, scale: 0.8, filter: 'blur(20px)' }}
          animate={phase >= 2 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 0, scale: 0.8, filter: 'blur(20px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <img src={abLogo} alt="AB Sustainability" className="w-full h-auto object-contain drop-shadow-2xl brightness-110" />
        </motion.div>
      </div>

      <div className="w-[55%] h-full flex flex-col justify-center pl-[8vw] pr-[5vw] relative z-10">
        <motion.div
          className="overflow-hidden mb-6"
        >
          <motion.h2
            className="text-[4vw] font-bold text-white leading-tight"
            initial={{ y: "100%" }}
            animate={phase >= 3 ? { y: 0 } : { y: "100%" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Corporate &<br/>Ventures
          </motion.h2>
        </motion.div>

        <motion.div
          className="h-[2px] bg-blue-500 w-[10vw] mb-8"
          initial={{ scaleX: 0, transformOrigin: 'left' }}
          animate={phase >= 3 ? { scaleX: 1 } : { scaleX: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
        />

        <div className="flex flex-col gap-4">
          {['Build', 'Grow', 'Sustain', 'Succeed'].map((word, i) => (
            <motion.div
              key={word}
              className="flex items-center gap-4 text-[2vw] font-light text-slate-300"
              initial={{ opacity: 0, x: 30 }}
              animate={phase >= 4 ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }}
              transition={{ duration: 0.6, delay: i * 0.15, ease: "easeOut" }}
            >
              <div className="w-2 h-2 rounded-full bg-blue-400" />
              <span className="tracking-widest uppercase">{word}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}