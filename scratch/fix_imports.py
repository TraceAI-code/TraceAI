import os

for path in ['frontend/src/pages/ReplayPage.tsx', 'frontend/src/services/auditReportService.ts']:
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    text = text.replace('  ShieldAlert,\r\n', '').replace('  ShieldAlert,\n', '')
    text = text.replace("import { getDecisions } from './decisionService';\r\n", '').replace("import { getDecisions } from './decisionService';\n", '')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)

print("done")

