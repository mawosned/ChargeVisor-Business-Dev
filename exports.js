(function createExports(){
  'use strict';
  const money=n=>Number(n||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const energy=n=>Number(n||0).toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:2});
  const dateText=d=>/^\d{4}-\d\d-\d\d$/.test(d||'')?d.slice(8)+'.'+d.slice(5,7)+'.'+d.slice(0,4):(d||'');
  const slug=s=>String(s||'bericht').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g,'_').slice(0,46);
  const filebase=d=>'ChargeVisor_'+slug(d.company)+'_'+(d.from||'alle')+'_'+(d.to||'alle');
  const header=['Session ID','Beginn','Ende','Standort','Ladestation','Connector ID','Ladepunkt','Nutzer','RFID / Autorisierung','Stopgrund','Zähler Start','Zähler Ende','Energie (kWh)','Dauer','Tarif (EUR/kWh)','Betrag (EUR)','Status'];
  const record=r=>[r.sessionId||'',r.start||r.date,r.end||'',r.site||'',r.station||r.point||'',r.connector??'',r.point||'',r.user||'',r.rfid||'',r.stopReason||'',r.meterStart??'',r.meterStop??'',Number(r.kwh)||0,r.duration||'',Number(r.rate)||0,Number(r.amount)||0,r.status||''];
  // The first 29 columns follow the reference CSV. Optional data remains empty.
  const liveColumns=[
    ['Session ID','sessionId',20],['Started','start',30],['Ended','end',30],
    ['Location ID','siteId',39],['Charge Station ID','stationId',39],['EVSE','evse',25],
    ['Connector ID','connector',16],['Location Name','site',28],['Charge Station Name','station',28],
    ['Type','type',18],['Authorization','authorization',39],['Charge Key Name','cardName',26],
    ['Organization Name','organization',27],['User Name','user',23],['Stop Reason','stopReason',22],
    ['Meter Start','meterStart',17],['Meter Stop','meterStop',17],['Signed Meter','signedMeter',17],
    ['Energy in kWh','kwh',18,3],['Duration in Minutes','durationMinutes',22,1],
    ['Invoicing Type','invoicingType',18],['Price Type','priceType',17],['Currency','currency',15],
    ['Start Fee Price','startFee',18,2],['Time Price','timePrice',17,2],['Energy Price','netEnergyAmount',17,2],
    ['Session Price Sum','amount',21,2],['Platform Fee','platformFee',17,2],['Payout Price','payoutPrice',17,2],
    ['Ladepunkt','point',26],['Tarif (EUR/kWh)','rate',20,4],['Status','status',16]
  ];
  function liveRecord(row){
    const fields={...row,sessionId:String(row.sessionId??''),currency:row.rate==null?null:'EUR',
      startFee:row.amount==null?null:0,timePrice:row.amount==null?null:0};
    return liveColumns.map(([,key])=>fields[key]);
  }
  const group=items=>{
    const m=new Map();
    items.forEach(r=>{const k=r.user||'Unbekannt';const v=m.get(k)||{user:k,count:0,kwh:0,amount:0,rate:r.rate};v.count++;v.kwh+=Number(r.kwh)||0;v.amount+=Number(r.amount)||0;m.set(k,v);});
    return Array.from(m.values()).sort((a,b)=>b.kwh-a.kwh);
  };
  const groupPoints=items=>{
    const m=new Map();
    items.forEach(r=>{const k=(r.site||'')+'|'+(r.point||'');const v=m.get(k)||{name:r.point||'Unbekannt',site:r.site||'',count:0,kwh:0,amount:0};v.count++;v.kwh+=Number(r.kwh)||0;v.amount+=Number(r.amount)||0;m.set(k,v);});
    return [...m.values()].sort((a,b)=>b.kwh-a.kwh);
  };
  function download(blob,name){
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function csvBlob(d){
    const quote=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
    let vals;
    if(d.live){
      vals=[liveColumns.map(([label])=>label),...d.rows.map(row=>liveRecord(row).map((value,i)=>{
        const decimals=liveColumns[i][3];
        if(typeof value==='number'&&decimals!==undefined)
          return value.toLocaleString('de-DE',{useGrouping:false,minimumFractionDigits:decimals===4?2:decimals,maximumFractionDigits:decimals});
        return typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(value)?"'"+value:value;
      }))];
    }else{
      vals=[header,...d.rows.map(row=>record(row).map((value,i)=>
        [12,14,15].includes(i)&&typeof value==='number'?money(value):value))];
    }
    const csv='\ufeff'+vals.map(row=>row.map(quote).join(';')).join('\r\n');
    return new Blob([csv],{type:'text/csv;charset=utf-8'});
  }
  const enc=s=>new TextEncoder().encode(s);
  const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const letter=i=>{let s='';for(let n=i+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  function cells(row,idx,styles={}){
    return '<row r="'+idx+'">'+row.map((v,i)=>{
      if(v===null||v===undefined)return '';
      const ref=letter(i)+idx,style=styles[i]??0;
      if(v&&typeof v==='object'&&v.formula){
        return '<c r="'+ref+'" s="'+style+'"><f>'+xml(v.formula)+'</f><v>'+Number(v.cached||0)+'</v></c>';
      }
      if(typeof v==='boolean')return '<c r="'+ref+'" t="b"><v>'+Number(v)+'</v></c>';
      return typeof v==='number'
        ?'<c r="'+ref+'" s="'+style+'"><v>'+v+'</v></c>'
        :'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';
    }).join('')+'</row>';
  }
  const stylesXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <numFmts count="4"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="0.000"/><numFmt numFmtId="167" formatCode="0.00##"/></numFmts>
      <fonts count="3">
        <font><sz val="11"/><name val="Aptos"/><color rgb="FF18372F"/></font>
        <font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font>
        <font><b/><sz val="12"/><name val="Aptos"/><color rgb="FF067D67"/></font>
      </fonts>
      <fills count="3">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FF113F38"/><bgColor indexed="64"/></patternFill></fill>
      </fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="7">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/>
        <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
      </cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`;
  function sheet(rows,widths,freeze,filter){
    const colXml=widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      +'<dimension ref="A1:'+letter(Math.max(0,widths.length-1))+Math.max(1,rows.length)+'"/>'
      +(freeze?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>':'')
      +'<cols>'+colXml+'</cols><sheetData>'+rows.join('')+'</sheetData>'
      +(filter?'<autoFilter ref="A1:'+letter(widths.length-1)+Math.max(1,rows.length)+'"/>':'')+'</worksheet>';
  }
  const u16=n=>Uint8Array.of(n&255,(n>>>8)&255);
  const u32=n=>Uint8Array.of(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255);
  const concat=xs=>{const len=xs.reduce((n,v)=>n+v.length,0),res=new Uint8Array(len);let at=0;xs.forEach(v=>{res.set(v,at);at+=v.length;});return res;};
  const crc32=bytes=>{let crc=-1;for(const b of bytes){crc^=b;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);}return (crc^(-1))>>>0;};
  function zip(files){
    const local=[],central=[];let offset=0;
    for(const [filename,source] of files){
      const name=enc(filename),data=enc(source),crc=crc32(data);
      const head=concat([u32(0x04034b50),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);
      local.push(head);
      central.push(concat([u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));
      offset+=head.length;
    }
    const cd=concat(central),end=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(cd.length),u32(offset),u16(0)]);
    return new Blob([concat([...local,cd,end])],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function xlsxBlob(d){
  const n=d.rows.length;
  const labels=d.live?liveColumns.map(([label])=>label):header;
  const liveStyles={1:4,2:3,3:5,4:6};
  const detailStyles=d.live?liveColumns.map(([, , , decimals])=>liveStyles[decimals]??0):{12:3,14:3,15:3};
  const rows=[cells(labels,1,Array(labels.length).fill(1))];
  d.rows.forEach((r,i)=>rows.push(cells(d.live?liveRecord(r):record(r),i+2,detailStyles)));
  const sumKwh=d.rows.reduce((t,r)=>t+Number(r.kwh||0),0),sumEuro=d.rows.reduce((t,r)=>t+Number(r.amount||0),0);
  const detailSum=(key,fallback,cached)=>{
    if(!n)return 0;
    const column=d.live?letter(liveColumns.findIndex(col=>col[1]===key)):fallback;
    return {formula:"SUM('Ladevorgänge'!"+column+"2:"+column+(n+1)+")",cached};
  };
  const summary=[
    cells(['CHARGEVISOR | LADEBERICHT'],1,{0:2}),
    cells(['Kunde',d.company],2),
    cells(['Zeitraum',(dateText(d.from)||'Beginn')+' - '+(dateText(d.to)||'Ende')],3),
    cells(['Ladevorgänge',n],4,{1:2}),
    cells(['Energie gesamt (kWh)',detailSum('kwh','M',sumKwh)],5,{1:d.live?5:3}),
    cells(['Berechneter Betrag (EUR)',detailSum('amount','P',sumEuro)],6,{1:3}),
    cells([''],7),
    cells(['Nutzer','Ladevorgänge','kWh','Betrag (EUR)'],8,[1,1,1,1])
  ];
  const users=group(d.rows),points=groupPoints(d.rows);
  users.forEach((u,i)=>summary.push(cells([u.user,u.count,u.kwh,u.amount],i+9,{2:3,3:3})));
  summary.push(cells([d.live?'Summen verwenden Messwerte und gespeicherte Tarife ohne Umsatzsteueraufteilung. Leere Angaben sind nicht erfasst.':'Hinweis: Demo-Tarife und Musterdaten – keine Rechnung.'],users.length+11));
  const userRows=[cells(['Nutzer','Ladevorgänge','Energie (kWh)','Betrag (EUR)'],1,[1,1,1,1]),
    ...users.map((u,i)=>cells([u.user,u.count,u.kwh,u.amount],i+2,{2:3,3:3}))];
  const pointRows=[cells(['Standort','Ladepunkt','Ladevorgänge','Energie (kWh)','Betrag (EUR)'],1,[1,1,1,1,1]),
    ...points.map((u,i)=>cells([u.site,u.name,u.count,u.kwh,u.amount],i+2,{3:3,4:3}))];
  const sheets=[
    ['xl/worksheets/sheet1.xml',sheet(summary,[34,27,22,25],false,false)],
    ['xl/worksheets/sheet2.xml',sheet(rows,d.live?liveColumns.map(([, ,width])=>width):
      [39,25,25,29,29,17,27,25,25,22,20,20,20,20,20,20,19],true,true)],
    ['xl/worksheets/sheet3.xml',sheet(userRows,[33,21,21,25],true,false)],
    ['xl/worksheets/sheet4.xml',sheet(pointRows,[30,30,20,23,23],true,false)]
  ];
  const sheetTags=['Auswertung','Ladevorgänge','Nutzer','Ladepunkte'].map((name,i)=>'<sheet name="'+name+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('');
  const wb='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    +'<sheets>'+sheetTags+'</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  const sheetOverrides=sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
  const rels=sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')
    +'<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  const files=[
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      +'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      +'<Default Extension="xml" ContentType="application/xml"/>'
      +'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      +'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      +sheetOverrides+'</Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml',wb],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels+'</Relationships>'],
    ['xl/styles.xml',stylesXml],
    ...sheets
  ];
  return zip(files);
}
  function pdfSafe(value){
    const map={'€':'EUR','–':'-','—':'-','’':"'",'“':'"','”':'"','•':'-','→':'>'};
    return Array.from(String(value??'')).map(c=>map[c]??(c.charCodeAt(0)<256?c:'?')).join('');
  }
  function pdfEsc(value){return pdfSafe(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
  function pdfBlob(d, logo=null){
  const W=842,H=595,M=40, pages=[];
  const live=d.live===true;
  const rgb=(r,g,b)=>`${r} ${g} ${b}`;
  const dark=rgb(.045,.17,.16),ink=rgb(.10,.22,.20),muted=rgb(.42,.53,.48),mint=rgb(.10,.78,.63),white=rgb(1,1,1),soft=rgb(.92,.97,.94);
  let commands=[],y=0,pageNumber=0;
  const safe=v=>pdfEsc(v);
  const t=(str,x,top,sz=9,bold=false,color=ink)=>{
    commands.push(color+' rg BT /'+(bold?'F2':'F1')+' '+sz+' Tf 1 0 0 1 '+x+' '+(H-top-sz)+' Tm ('+safe(str)+') Tj ET');
  };
  const rect=(x,top,w,h,color)=>commands.push(color+' rg '+x+' '+(H-top-h)+' '+w+' '+h+' re f');
  const hline=(top)=>commands.push(rgb(.85,.9,.87)+' RG 0.7 w '+M+' '+(H-top)+' m '+(W-M)+' '+(H-top)+' l S');
  const footer=()=>{
    hline(H-48);
    t('Walectra | Mayer & Obeser GbR | info@walectra.de',M,H-37,8,false,muted);
    t(live?'ChargeVisor Business':'ChargeVisor - DEMO, keine Abrechnungsgrundlage',M,H-24,7,false,muted);
    t('Seite '+pageNumber,W-93,H-31,8,true,muted);
  };
  const finish=()=>{if(commands.length){footer();pages.push(commands.join('\n'));}};
  function newPage(){
    if(commands.length)finish();
    commands=[];pageNumber++;
    rect(0,0,W,81,dark);rect(0,78,W,3,mint);
    if(logo&&logo.binary)commands.push('q 172 0 0 54 '+M+' '+(H-66)+' cm /Logo Do Q');
    else t('ChargeVisor',M,15,24,true,white);
    t(live?'LADEBERICHT':'LADEBERICHT  |  DEMO',W-235,21,13,true,white);
    t('ChargeVisor by Walectra',W-235,44,9,false,rgb(.62,.91,.83));
    y=108;
  }
  const enough=h=>{if(y+h>H-64)newPage();};
  const heading=(str)=>{enough(36);t(str,M,y,13,true,dark);y+=27;};
  const rowTable=(headers,positions,widths,values)=>{
    const startHeader=()=>{
      enough(27);rect(M,y,W-M*2,24,dark);
      headers.forEach((v,i)=>t(v,positions[i],y+6,8,true,white));
      y+=27;
    };
    startHeader();
    if(!values.length){t('Keine Einträge vorhanden',M+8,y+5,9,false,muted);y+=28;return;}
    values.forEach((row,i)=>{
      if(y+22>H-66){newPage();startHeader();}
      if(i%2===0)rect(M,y,W-M*2,21,soft);
      row.forEach((v,j)=>{
        const str=String(v??''),max=widths[j];
        const clipped=str.length>max?str.slice(0,max-1)+'…':str;
        t(clipped,positions[j],y+6,8,j===row.length-1,ink);
      });
      y+=22;
    });
  };
  const sumKwh=d.rows.reduce((acc,r)=>acc+Number(r.kwh||0),0);
  newPage();
  t('Kunde',M,y,9,false,muted);
  t(live?String(d.company||'Kunde').slice(0,48):d.company||'Kunde',M,y+15,17,true,dark);
  t('Berichtszeitraum',430,y,9,false,muted);
  t(live&&!d.from?'Noch keine Ladevorgänge':(dateText(d.from)||'Beginn')+' bis '+(dateText(d.to)||'Ende'),
    430,y+15,12,true,ink);
  y+=63;
  const blocks=live?[
    ['LADEVORGÄNGE',String(d.rows.length)],
    ['GEMELDETE ENERGIE',d.rows.some(r=>r.kwh!=null)?energy(sumKwh)+' kWh':'–']
  ]:[
    ['LADEVORGÄNGE',String(d.rows.length)],
    ['ENERGIE GESAMT',energy(sumKwh)+' kWh'],
    ['BERECHNETER BETRAG',money(d.rows.reduce((sum,r)=>sum+Number(r.amount||0),0))+' EUR']
  ];
  blocks.forEach((p,i)=>{
    const x=M+i*257;
    rect(x,y,245,67,soft);
    t(p[0],x+13,y+11,9,true,muted);
    t(p[1],x+13,y+30,19,true,dark);
  });
  y+=91;
  if(live){
    t('Bis zu 100 ausgewählte Ladevorgänge. Beträge verwenden den Tarif zum Ladestart.',M,y,9,false,muted);
    y+=24;
    heading('Ladevorgänge');
    rowTable(['BEGINN','ENDE','STANDORT','LADEPUNKT','NUTZER / ZUGANG','ENERGIE','EUR/kWh','BETRAG','STATUS'],
      [49,145,241,338,435,545,614,677,745],[19,19,16,16,17,12,10,12,12],
      d.rows.map(r=>[r.start,r.end,r.site,r.point,r.user,r.kwh==null?'–':energy(r.kwh)+' kWh',r.rate==null?'–':String(r.rate).replace('.',','),r.amount==null?'–':money(r.amount)+' EUR',r.status]));
  }else{
  const users=group(d.rows),points=groupPoints(d.rows);
  t('Tarife basieren auf ChargeVisor-Demo-Einstellungen. Es handelt sich weder um eine Rechnung noch um einen steuerlich geprüften Betrag.',M,y,8,false,muted);
  y+=26;
  heading('Auswertung nach Nutzer');
  rowTable(['NUTZER','VORGÄNGE','ENERGIE','Ø EUR/kWh','BETRAG'],[49,310,425,555,677],[38,14,15,13,15],
    users.map(u=>[u.user,String(u.count),energy(u.kwh)+' kWh',money(u.kwh?u.amount/u.kwh:0),money(u.amount)+' EUR']));
  y+=18;
  heading('Auswertung nach Standort / Ladepunkt');
  rowTable(['STANDORT','LADEPUNKT','VORGÄNGE','ENERGIE','BETRAG'],[49,245,465,565,685],[28,31,12,14,14],
    points.map(p=>[p.site,p.name,String(p.count),energy(p.kwh)+' kWh',money(p.amount)+' EUR']));
  y+=18;
  heading('Ladevorgänge im Detail');
  rowTable(['DATUM','NUTZER','LADEPUNKT','kWh','TARIF','BETRAG','STATUS'],[49,156,310,481,548,633,719],[15,21,27,9,12,12,15],
    d.rows.map(r=>[dateText(r.date),r.user,r.point,energy(r.kwh),money(r.rate),money(r.amount),r.status||'']));
  y+=18;
  heading('Technische Angaben (aus den Sitzungsdaten)');
  t('Felder analog zum PUMP-Session-Export, soweit ChargeVisor sie bereits kennt.',M,y,9,false,muted);y+=20;
  rowTable(['BEGONNEN','BEENDET','STATION','CONNECTOR','AUTORISIERUNG','STOPGRUND'],[49,180,310,459,525,669],[19,19,24,11,22,18],
    d.rows.map(r=>[r.start||r.date,r.end||'',r.station||'',String(r.connector??''),r.rfid||'',r.stopReason||'']));
  y+=18;
  heading('Sitzungs-ID und Zählerstände');
  rowTable(['SESSION-ID','ZÄHLER START','ZÄHLER ENDE','ENERGIE','LADEPUNKT'],[49,350,475,600,690],[46,17,17,11,18],
    d.rows.map(r=>[r.sessionId||'Nicht übermittelt',r.meterStart??'',r.meterStop??'',energy(r.kwh)+' kWh',r.point||'']));
  }
  finish();
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  let logoId=0;
  if(logo&&logo.binary){
    logoId=objects.length;
    objects.push('<< /Type /XObject /Subtype /Image /Width '+logo.width+' /Height '+logo.height
      +' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+logo.binary.length
      +' >>\nstream\n'+logo.binary+'\nendstream');
  }
  const pageIds=[];
  pages.forEach(content=>{
    const pId=objects.length,cId=pId+1;
    pageIds.push(pId+' 0 R');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>'
      +(logoId?' /XObject << /Logo '+logoId+' 0 R >>':'')
      +' >> /Contents '+cId+' 0 R >>');
    objects.push('<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream');
  });
  objects[2]='<< /Type /Pages /Kids ['+pageIds.join(' ')+'] /Count '+pages.length+' >>';
  let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets[i]=pdf.length;pdf+=i+' 0 obj\n'+objects[i]+'\nendobj\n';}
  const xref=pdf.length;
  pdf+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';
  for(let i=1;i<objects.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  const out=new Uint8Array(pdf.length);
  for(let i=0;i<pdf.length;i++)out[i]=pdf.charCodeAt(i)&255;
  return new Blob([out],{type:'application/pdf'});
}
  async function loadLogo(){
    try{
      const image=await new Promise(resolve=>{
        const pic=new Image();
        pic.onload=()=>resolve(pic);
        pic.onerror=()=>resolve(null);
        pic.src='/assets/chargevisor-login-white.png';
      });
      if(!image)return null;
      const canvas=document.createElement('canvas');
      canvas.width=512;canvas.height=160;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#0b2b28';ctx.fillRect(0,0,512,160);
      ctx.save();ctx.filter='brightness(0) invert(1)';
      const scale=Math.min(488/image.naturalWidth,152/image.naturalHeight);
      const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      ctx.drawImage(image,(512-w)/2,(160-h)/2,w,h);ctx.restore();
      const data=canvas.toDataURL('image/jpeg',.85);
      return {binary:atob(data.slice(data.indexOf(',')+1)),width:512,height:160};
    }catch(error){console.warn('ChargeVisor PDF logo unavailable',error);return null;}
  }
  globalThis.ChargeVisorExports={csvBlob,xlsxBlob,pdfBlob,
    exportCSV(d){download(csvBlob(d),filebase(d)+'.csv');},
    exportXLSX(d){download(xlsxBlob(d),filebase(d)+'.xlsx');},
    async exportPDF(d){const logo=await loadLogo();download(pdfBlob(d,logo),filebase(d)+'.pdf');}
  };
})();
