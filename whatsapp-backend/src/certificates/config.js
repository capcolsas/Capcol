export const certificateTemplateConfig = {
  timezone: 'America/Bogota',
  locale: 'es-CO',
  city: 'Medellin',
  companyLegalName: 'CONSULTORES EN ADMINISTRACION PUBLICA COLOMBIANA S.A.S.',
  companyNit: '900.939.656-7',
  companyRegimeText: '[ Actividad Principal: 7020 ] [ Regimen Simple ]',
  layout: {
    margins: {
      top: 132,
      right: 74,
      bottom: 130,
      left: 74
    },
    header: {
      top: 18,
      height: 104,
      fullWidth: true
    },
    footer: {
      bottomOffset: 112,
      height: 90,
      fullWidth: true
    },
    signature: {
      width: 180,
      height: 90
    }
  },
  header: {
    imagePath: './assets/certificate-header-blank.png',
    maxWidth: '100%',
    maxHeight: '100%',
    align: 'left'
  },
  footer: {
    imagePath: './assets/certificate-footer-blank.png',
    maxWidth: '100%',
    maxHeight: '100%',
    lines: []
  },
  signature: {
    imagePath: './assets/certificate-signature-blank.png',
    maxWidth: '180px',
    maxHeight: '90px',
    signerName: 'LUISA FERNANDA TORRES LOPEZ',
    signerTitle: 'Representante Legal'
  }
};
