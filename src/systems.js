const LB_PER_KG = 2.20462;
const SEA_LEVEL_PSI = 14.696;
const PRESSURE_EXPONENT = 5.2559;
const FT_PRESSURE_LAPSE = 6.8756e-6;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const pair = (values) => [finite(values?.[0]), finite(values?.[1])];

function pressureAtAltitude(altitudeFt) {
  return SEA_LEVEL_PSI * Math.pow(Math.max(0.05, 1 - FT_PRESSURE_LAPSE * Math.max(0, altitudeFt)), PRESSURE_EXPONENT);
}

function altitudeAtPressure(pressurePsi) {
  return Math.max(0, (1 - Math.pow(clamp(pressurePsi, 0.01, SEA_LEVEL_PSI) / SEA_LEVEL_PSI, 1 / PRESSURE_EXPONENT)) / FT_PRESSURE_LAPSE);
}

function outsideTemperature(altitudeFt) {
  return 15 - 6.5 * Math.min(11, Math.max(0, altitudeFt * 0.0003048));
}

export class AircraftSystems {
  constructor() {
    this.hydraulicPressureKpsi = [2.85, 2.85];
    this.oxygenQuantityPct = 100;
    this.oilTemperatureC = [20, 20];
    this.fuelTemperatureC = 15;
  }

  step(dt, inputs = {}) {
    dt = clamp(finite(dt), 0, 0.25);
    const rpm = pair(inputs.engineRpm);
    const altitudeFt = Math.max(0, finite(inputs.altitudeFt));
    const fuelKg = Math.max(0, finite(inputs.fuelKg));
    const fuelAftKg = clamp(finite(inputs.fuelAftKg), 0, fuelKg);
    const gearMoving = Boolean(inputs.gearMoving);
    const running = rpm.map((value) => value > 10);
    const engineCount = running.filter(Boolean).length;

    this.hydraulicPressureKpsi = this.hydraulicPressureKpsi.map((pressure, index) => {
      const target = running[index] ? 3 : 0;
      const response = (target - pressure) * (1 - Math.exp(-dt / 18));
      return clamp(pressure + response - (gearMoving ? 0.06 * dt : 0), 0, 3.2);
    });

    const oilPressurePsi = rpm.map((value) => value > 3 ? Math.min(90, 7 + value * 0.65) : 0);
    this.oilTemperatureC = this.oilTemperatureC.map((temperature, index) => {
      const target = 20 + rpm[index] * 0.65 + (inputs.afterburner?.[index] ? 8 : 0);
      const response = 1 - Math.exp(-dt / (running[index] ? 90 : 240));
      return temperature + (target - temperature) * response;
    });

    const ambientPsi = pressureAtAltitude(altitudeFt);
    const cabinFloorPsi = pressureAtAltitude(8000);
    const cabinPsi = altitudeFt <= 8000
      ? ambientPsi
      : altitudeFt < 25000
        ? cabinFloorPsi
        : ambientPsi + 5.5;
    const cabinAltitudeFt = altitudeAtPressure(cabinPsi);
    const differentialPressurePsi = Math.max(0, cabinPsi - ambientPsi);
    if (engineCount > 0) this.oxygenQuantityPct = Math.max(0, this.oxygenQuantityPct - dt * (altitudeFt > 20000 ? 0.004 : 0.0005));

    const totalFuelLb = fuelKg * LB_PER_KG;
    const aftFuelLb = fuelAftKg * LB_PER_KG;
    const forwardFuelLb = totalFuelLb - aftFuelLb;
    const fuelTanksLb = [forwardFuelLb / 3, forwardFuelLb / 3, forwardFuelLb / 3, aftFuelLb / 3, aftFuelLb / 3, aftFuelLb / 3];
    const busCurrentA = clamp(20 + rpm.reduce((sum, value) => sum + value * 1.3, 0) + (inputs.lightsOn ? 25 : 0), 0, 400);
    const busVoltageV = engineCount > 1 ? 28.2 : engineCount === 1 ? 27.8 : 24.1;
    const fuelTempTarget = outsideTemperature(altitudeFt) + 12 + Math.max(...rpm) * 0.08;
    this.fuelTemperatureC += (fuelTempTarget - this.fuelTemperatureC) * (1 - Math.exp(-dt / 600));

    return {
      hydraulicPressureKpsi: [...this.hydraulicPressureKpsi],
      oilPressurePsi,
      oilTemperatureC: [...this.oilTemperatureC],
      busCurrentA,
      busVoltageV,
      oxygenQuantityPct: this.oxygenQuantityPct,
      cabinAltitudeFt,
      differentialPressurePsi,
      fuelTemperatureC: this.fuelTemperatureC,
      fuelTanksLb,
    };
  }
}
