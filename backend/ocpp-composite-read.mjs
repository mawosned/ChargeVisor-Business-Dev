/**
 * OCPP 1.6J GetCompositeSchedule CALLRESULT -> small, safe read-only diagnostics.
 * This describes the schedule reported by the charging station, NOT which
 * party imposed a limit. No schedule / Rejected is not evidence of "16 A".
 */
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const num=x=>typeof x==='number'&&Number.isFinite(x);
export function summarizeCompositeSchedule(reply){
  if(!isObject(reply)||!['Accepted','Rejected'].includes(reply.status))
    throw new Error('Ungültige GetCompositeSchedule-Antwort');
  if(reply.status==='Rejected')return {
    status:'Rejected',reported:false,unit:null,periods:[],
    note:'Wallbox hat die optionale OCPP-GetCompositeSchedule-Abfrage abgelehnt.'
  };
  const schedule=reply.chargingSchedule;
  if(!isObject(schedule)||!['A','W'].includes(schedule.chargingRateUnit)||
    !Array.isArray(schedule.chargingSchedulePeriod)||
    schedule.chargingSchedulePeriod.length<1||schedule.chargingSchedulePeriod.length>128)
    return {status:'Accepted',reported:false,unit:null,periods:[],
      note:'Wallbox hat Accepted ohne auswertbaren Ladeplan geliefert.'};
  const periods=schedule.chargingSchedulePeriod.map(p=>{
    if(!isObject(p)||!Number.isInteger(p.startPeriod)||p.startPeriod<0||
       !num(p.limit)||p.limit<0||p.limit>1000000||
       (p.numberPhases!==undefined&&(!Number.isInteger(p.numberPhases)||
         p.numberPhases<1||p.numberPhases>3)))
      throw new Error('Wallbox meldet ungültige Ladeplanwerte');
    return {startSecond:p.startPeriod,limit:p.limit,
      numberPhases:p.numberPhases??null};
  });
  const duration=Number.isInteger(reply.duration)&&reply.duration>0?reply.duration:null;
  const unit=schedule.chargingRateUnit;
  return {status:'Accepted',reported:true,unit,
    durationSeconds:duration,
    scheduleStart:typeof reply.scheduleStart==='string'&&
      Number.isFinite(Date.parse(reply.scheduleStart))?reply.scheduleStart:null,
    periods,
    note:'OCPP meldet einen wirksamen Ladeplan. Dessen Ursprung (Wallbox/CSMS/Altprofil) ist damit nicht bewiesen.'
  };
}
