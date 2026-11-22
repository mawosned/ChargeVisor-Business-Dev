import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./scripts',
  testMatch:'ui-regression.spec.mjs',
  fullyParallel:false,
  timeout:30000,
  expect:{timeout:8000},
  reporter:'list',
  use:{
    baseURL:'http://127.0.0.1:10000',
    trace:'retain-on-failure',
    screenshot:'only-on-failure',
    reducedMotion:'no-preference',
  },
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}}],
});
