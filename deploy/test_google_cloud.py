import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('google-cloud.sh').resolve()

class GoogleCloudSetupTests(unittest.TestCase):
    def run_case(self, case, resume=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / 'calls.jsonl'
            stub = root / 'gcloud'
            stub.write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['GCLOUD_TEST_LOG'],'a') as log: log.write(json.dumps(args)+'\\n')
cmd=[a for a in args if not a.startswith('--')]
case=os.environ['GCLOUD_TEST_CASE']
if cmd[:2]==['auth','list']: print('authorized@example.test')
elif cmd[:2]==['services','enable']:
 if case=='api_denied': print('API permission denied',file=sys.stderr);sys.exit(1)
elif cmd[:3]==['compute','instances','list']:
 if case=='list_denied': print('Compute access denied',file=sys.stderr);sys.exit(1)
 if case in ('exists','resume','wrong_vm','iap_denied'): print('ed-kocluk')
elif cmd[:3]==['compute','instances','describe']:
 print(json.dumps({'status':'RUNNING','tags':{'items':['ed-kocluk-web','ed-kocluk-iap'] if case!='wrong_vm' else []},'networkInterfaces':[{'network':'projects/test/global/networks/ed-kocluk-net','accessConfigs':[{'natIP':'203.0.113.10'}]}]}))
elif cmd[:3]==['compute','addresses','describe']: print('203.0.113.10')
elif cmd[:2]==['compute','ssh']:
 if case=='iap_denied': print('IAP lookup failed',file=sys.stderr);sys.exit(1)
 if '--command=sudo bash -se' in args: sys.stdin.read()
''')
            stub.chmod(0o755)
            env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'], 'GCLOUD_TEST_LOG': str(log), 'GCLOUD_TEST_CASE': case, 'RESUME': '1' if resume else '0'}
            result = subprocess.run(['bash',str(SCRIPT),'sinavmatikkocgpt'],env=env,capture_output=True,text=True,timeout=30)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            return result,calls

    def test_api_denial_is_visible_and_stops_before_compute(self):
        result,calls=self.run_case('api_denied')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('API permission denied',result.stderr)
        self.assertFalse(any('compute' in c for c in calls))

    def test_compute_denial_does_not_create_resources(self):
        result,calls=self.run_case('list_denied')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Compute access denied',result.stderr)
        self.assertFalse(any('create' in c for c in calls))
        enable=next(i for i,c in enumerate(calls) if 'enable' in c)
        first_compute=next(i for i,c in enumerate(calls) if 'compute' in c)
        self.assertLess(enable,first_compute)

    def test_existing_instance_and_data_are_preserved(self):
        result,calls=self.run_case('exists')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('already exists',result.stdout)
        self.assertFalse(any('create' in c or 'scp' in c or 'ssh' in c for c in calls))

    def test_successful_flow_has_progress_and_noninteractive_compute(self):
        result,calls=self.run_case('success')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('[7/7]',result.stdout)
        self.assertTrue(any('scp' in c for c in calls))
        self.assertTrue(any('ssh' in c for c in calls))
        self.assertTrue(all('--quiet' in c for c in calls if 'compute' in c))
        self.assertFalse(any('instances' in c and 'describe' in c for c in calls))

    def test_resume_reuses_existing_vm_without_creating_resources(self):
        result,calls=self.run_case('resume',resume=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse(any('create' in c for c in calls))
        self.assertTrue(any('scp' in c for c in calls))

    def test_resume_does_not_adopt_an_unrelated_vm(self):
        result,calls=self.run_case('wrong_vm',resume=True)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any('create' in c or 'scp' in c or 'ssh' in c for c in calls))

    def test_iap_failure_stops_before_file_transfer(self):
        result,calls=self.run_case('iap_denied',resume=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('IAP lookup failed',result.stderr)
        self.assertFalse(any('create' in c or 'scp' in c for c in calls))

if __name__=='__main__':
    unittest.main()
