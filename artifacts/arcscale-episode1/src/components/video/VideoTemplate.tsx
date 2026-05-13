import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS: Record<string, number> = {
  opening: 12000,
  problem: 18000,
  solution: 22000,
  reality: 18000,
  closing: 10000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  opening: Scene1,
  problem: Scene2,
  solution: Scene3,
  reality: Scene4,
  closing: Scene5,
};

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0a0a0f]" dir="rtl">
      {/* Noise texture overlay */}
      <div className="noise-bg" />

      {/* Persistent accent line — transforms across scenes */}
      <motion.div
        className="absolute h-[2px] bg-[#334155] z-10"
        animate={{
          width: sceneIndex === 0 ? '40%' : sceneIndex === 4 ? '20%' : 0,
          right: sceneIndex === 0 ? '10%' : sceneIndex === 4 ? '40%' : 0,
          top: sceneIndex === 0 ? '60%' : sceneIndex === 4 ? '70%' : '50%',
          opacity: sceneIndex === 0 ? 1 : sceneIndex === 4 ? 0.6 : 0,
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Persistent vertical divider for scene 3 */}
      <motion.div
        className="absolute w-[2px] h-full bg-[#334155]/30 top-0 z-10"
        animate={{ opacity: sceneIndex === 2 ? 1 : 0, right: '40%' }}
        transition={{ duration: 1 }}
      />

      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
