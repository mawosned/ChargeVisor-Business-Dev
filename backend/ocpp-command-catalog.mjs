// OCPP 1.6J CSMS -> charge point commands. This pure module does not modify
// charging sessions, RFID state or the existing production control endpoints.
// Commands are additionally gated to test-designated stations in the API.
export const OCPP_CSMS_ACTIONS=Object.freeze([
  'CancelReservation','ChangeAvailability','ChangeConfiguration','ClearCache',
  'ClearChargingProfile','DataTransfer','GetCompositeSchedule','GetConfiguration',
  'GetDiagnostics','GetLocalListVersion','RemoteStartTransaction',
  'RemoteStopTransaction','ReserveNow','Reset','SendLocalList',
  'SetChargingProfile','TriggerMessage','UnlockConnector','UpdateFirmware'
]);

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=value=>Number.isInteger(value)&&value>=0&&value<=2147483647;
const positive=value=>number(value)&&value>0;
const tag=value=>typeof value==='string'&&value.length>=1&&value.length<=20;
const text=(value,max=255)=>typeof value==='string'&&value.trim().length>=1&&value.length<=max;
const one=(value,allowed)=>allowed.includes(value);
const url=value=>{
  if(!text(value,2048))return false;
  try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!!u.hostname;}
  catch{return false;}
};
const timestamp=value=>text(value,40)&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value));
const optional=(value,fn)=>value===undefined||fn(value);
const ids=value=>Array.isArray(value)&&value.length<=50&&value.every(v=>text(v,50));
const keys=value=>value===undefined||ids(value);
const composite=value=>record(value)&&
  positive(value.chargingProfileId)&&number(value.stackLevel)&&
  one(value.chargingProfilePurpose,['ChargePointMaxProfile','TxDefaultProfile','TxProfile'])&&
  one(value.chargingProfileKind,['Absolute','Recurring','Relative'])&&
  optional(value.transactionId,positive)&&
  (value.chargingProfileKind!=='Recurring'||one(value.recurrencyKind,['Daily','Weekly']))&&
  optional(value.validFrom,timestamp)&&optional(value.validTo,timestamp)&&
  record(value.chargingSchedule)&&
  one(value.chargingSchedule.chargingRateUnit,['A','W'])&&
  optional(value.chargingSchedule.duration,positive)&&
  Array.isArray(value.chargingSchedule.chargingSchedulePeriod)&&
  value.chargingSchedule.chargingSchedulePeriod.length>0&&
  value.chargingSchedule.chargingSchedulePeriod.length<=128&&
  value.chargingSchedule.chargingSchedulePeriod.every(x=>record(x)&&number(x.startPeriod)&&
    typeof x.limit==='number'&&Number.isFinite(x.limit)&&x.limit>=0&&x.limit<=1000000&&
    optional(x.numberPhases,x=>positive(x)&&x<=3));

const validSendLocalList=value=>Array.isArray(value)&&value.length<=256&&value.every(x=>
  record(x)&&tag(x.idTag)&&optional(x.idTagInfo,i=>
    record(i)&&one(i.status,['Accepted','Blocked','Expired','Invalid','ConcurrentTx'])&&
    optional(i.expiryDate,timestamp)&&optional(i.parentIdTag,tag)));

export function validateOcppCsmsCommand(action,payload){
  if(!OCPP_CSMS_ACTIONS.includes(action))return {ok:false,error:'Unknown OCPP 1.6J CSMS command'};
  if(!record(payload))return {ok:false,error:'OCPP payload must be an object'};
  try{
    if(Buffer.byteLength(JSON.stringify(payload),'utf8')>16384)
      return {ok:false,error:'OCPP payload exceeds 16 KiB test limit'};
  }catch{return {ok:false,error:'OCPP payload cannot be serialized'};}
  let valid=false;
  switch(action){
    case 'CancelReservation': valid=positive(payload.reservationId);break;
    case 'ChangeAvailability':
      valid=number(payload.connectorId)&&one(payload.type,['Inoperative','Operative']);break;
    case 'ChangeConfiguration':
      valid=text(payload.key,50)&&typeof payload.value==='string'&&payload.value.length<=500;break;
    case 'ClearCache':
    case 'GetLocalListVersion':valid=Object.keys(payload).length===0;break;
    case 'ClearChargingProfile':
      valid=optional(payload.id,positive)&&optional(payload.connectorId,number)&&
        optional(payload.chargingProfilePurpose,x=>one(x,['ChargePointMaxProfile','TxDefaultProfile','TxProfile']))&&
        optional(payload.stackLevel,number);break;
    case 'DataTransfer':
      valid=text(payload.vendorId,255)&&optional(payload.messageId,x=>text(x,50))&&
        optional(payload.data,x=>typeof x==='string'&&x.length<=4096);break;
    case 'GetCompositeSchedule':
      valid=number(payload.connectorId)&&positive(payload.duration)&&
        optional(payload.chargingRateUnit,x=>one(x,['A','W']));break;
    case 'GetConfiguration':valid=keys(payload.key);break;
    case 'GetDiagnostics':
      valid=url(payload.location)&&optional(payload.retries,number)&&
        optional(payload.retryInterval,positive)&&
        optional(payload.startTime,timestamp)&&optional(payload.stopTime,timestamp);break;
    case 'RemoteStartTransaction':
      valid=tag(payload.idTag)&&optional(payload.connectorId,positive)&&
        optional(payload.chargingProfile,composite);break;
    case 'RemoteStopTransaction':valid=positive(payload.transactionId);break;
    case 'ReserveNow':
      valid=number(payload.connectorId)&&timestamp(payload.expiryDate)&&
        tag(payload.idTag)&&positive(payload.reservationId)&&
        optional(payload.parentIdTag,tag);break;
    case 'Reset':valid=one(payload.type,['Soft','Hard']);break;
    case 'SendLocalList':
      valid=number(payload.listVersion)&&one(payload.updateType,['Full','Differential'])&&
        optional(payload.localAuthorizationList,validSendLocalList);break;
    case 'SetChargingProfile':
      valid=number(payload.connectorId)&&composite(payload.csChargingProfiles);break;
    case 'TriggerMessage':
      valid=one(payload.requestedMessage,[
        'BootNotification','DiagnosticsStatusNotification','FirmwareStatusNotification',
        'Heartbeat','MeterValues','StatusNotification'])&&
        optional(payload.connectorId,number);break;
    case 'UnlockConnector':valid=positive(payload.connectorId);break;
    case 'UpdateFirmware':
      valid=url(payload.location)&&timestamp(payload.retrieveDate)&&
        optional(payload.retries,number)&&optional(payload.retryInterval,positive);break;
  }
  return valid?{ok:true}:{ok:false,error:'Invalid OCPP 1.6J payload for '+action};
}
