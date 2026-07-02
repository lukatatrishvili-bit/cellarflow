import { useState, useEffect } from 'react';

export function usePerformanceManager() {
  const [batteryLow, setBatteryLow] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  const [manualLowPower, setManualLowPower] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('vinea_low_power_ui') === 'true';
    }
    return false;
  });

  // Media query for OS-level prefers-reduced-motion
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    // Modern browsers support addEventListener, older use addListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
    } else {
      mediaQuery.addListener(handler);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handler);
      } else {
        mediaQuery.removeListener(handler);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Data Saver mode
    const conn = (navigator as any).connection;
    if (conn) {
      setDataSaver(conn.saveData === true);
      const handleConnChange = () => {
        setDataSaver(conn.saveData === true);
      };
      if (conn.addEventListener) {
        conn.addEventListener('change', handleConnChange);
        return () => conn.removeEventListener('change', handleConnChange);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 2. Battery status API
    if ('getBattery' in navigator) {
      let batteryObj: any = null;

      const updateBatteryStatus = (batt: any) => {
        // Low power if battery < 20% and NOT charging
        setBatteryLow(batt.level < 0.20 && !batt.charging);
      };

      (navigator as any).getBattery().then((batt: any) => {
        batteryObj = batt;
        updateBatteryStatus(batt);

        // Define bound handlers for correct cleanup reference
        const levelHandler = () => updateBatteryStatus(batt);
        const chargingHandler = () => updateBatteryStatus(batt);

        batt.addEventListener('levelchange', levelHandler);
        batt.addEventListener('chargingchange', chargingHandler);

        // Store cleanup handles on the object for closure execution
        batteryObj._levelHandler = levelHandler;
        batteryObj._chargingHandler = chargingHandler;
      }).catch((e: any) => {
        console.warn('Battery status API not accessible:', e);
      });

      return () => {
        if (batteryObj) {
          if (batteryObj._levelHandler) batteryObj.removeEventListener('levelchange', batteryObj._levelHandler);
          if (batteryObj._chargingHandler) batteryObj.removeEventListener('chargingchange', batteryObj._chargingHandler);
        }
      };
    }
  }, []);

  const toggleManualLowPower = () => {
    const nextVal = !manualLowPower;
    setManualLowPower(nextVal);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('vinea_low_power_ui', String(nextVal));
    }
  };

  // Combine conditions: OS prefers-reduced-motion, battery low, data saver, or manual settings
  const shouldReduceMotion = prefersReducedMotion || batteryLow || dataSaver || manualLowPower;

  return {
    shouldReduceMotion,
    batteryLow,
    dataSaver,
    manualLowPower,
    toggleManualLowPower
  };
}
