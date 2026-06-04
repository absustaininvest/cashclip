import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import abLogo from '@assets/absustain/public/logo-transparent.png';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 3500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center z-20"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: '-20vh', filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        className="w-[30vw] h-[15vw] mb-[4vw] flex items-center justify-center"
        initial={{ opacity: 0, filter: 'blur(20px)' }}
        animate={phase >= 1 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(20px)' }}
        transition={{ duration: 1 }}
      >
        <img src={abLogo} alt="AB Sustainability" className="max-w-full max-h-full object-contain" />
      </motion.div>

      <motion.div
        className="text-[2vw] text-blue-300 font-semibold tracking-widest mb-[2vw]"
        initial={{ opacity: 0, letterSpacing: '0em' }}
        animate={phase >= 2 ? { opacity: 1, letterSpacing: '0.1em' } : { opacity: 0, letterSpacing: '0em' }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      >
        AB Sustainability Investments
      </motion.div>

      <motion.p
        className="text-[1.8vw] text-slate-300 font-light max-w-[60vw] text-center leading-relaxed"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.4, duration: 0.8 }}
      >
        We believe every penny moves you forward — <br/>
        <span className="font-bold text-white mt-2 block text-[2.2vw]">BUILD · GROW · SUSTAIN · SUCCEED</span>
      </motion.p>
    </motion.div>
  );
}
