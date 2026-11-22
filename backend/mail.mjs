// Optional SMTP transport using an existing mailbox (e.g. IONOS). No separate mail subscription.
export async function sendInviteMail(env,to,name,url){
  if(!env.CV_SMTP_HOST||!env.CV_SMTP_USER||!env.CV_SMTP_PASS||!env.CV_SMTP_FROM)
    return {sent:false,reason:'not_configured'};
  const {default:nodemailer}=await import('nodemailer');
  const port=Number(env.CV_SMTP_PORT||587);
  const transport=nodemailer.createTransport({
    host:env.CV_SMTP_HOST,port,secure:port===465,requireTLS:port!==465,
    auth:{user:env.CV_SMTP_USER,pass:env.CV_SMTP_PASS},
    tls:{rejectUnauthorized:true},
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000
  });
  try{
    await transport.sendMail({
      from:env.CV_SMTP_FROM,to,
      subject:'Einladung zu ChargeVisor',
      text:'Hallo '+name+',\n\nfür dich wurde ein ChargeVisor-Zugang angelegt.\n' +
        'Bitte öffne den folgenden einmaligen Link innerhalb von 72 Stunden und lege dein Passwort fest:\n' +
        url+'\n\nFalls du keine Einladung erwartet hast, ignoriere diese Nachricht.\n\nChargeVisor by Walectra',
    });
    return {sent:true};
  }finally{transport.close();}
}
export async function sendAccessNoticeMail(env,to,subject,body){
  if(!env.CV_SMTP_HOST||!env.CV_SMTP_USER||!env.CV_SMTP_PASS||!env.CV_SMTP_FROM)
    return {sent:false,reason:'not_configured'};
  const {default:nodemailer}=await import('nodemailer');
  const port=Number(env.CV_SMTP_PORT||587);
  const transport=nodemailer.createTransport({
    host:env.CV_SMTP_HOST,port,secure:port===465,requireTLS:port!==465,
    auth:{user:env.CV_SMTP_USER,pass:env.CV_SMTP_PASS},
    tls:{rejectUnauthorized:true},
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000
  });
  try{
    await transport.sendMail({from:env.CV_SMTP_FROM,to,subject,text:body});
    return {sent:true};
  }finally{transport.close();}
}
