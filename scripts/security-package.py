"""Inspect the actual ZIP installer without extracting untrusted paths."""
import sys,zipfile,re,json,hashlib,pathlib,shutil
findings=[]; reports=[]
for filename in sys.argv[1:]:
 with zipfile.ZipFile(filename) as archive:
  names=archive.namelist()
  total=0
  for item in archive.infolist():
   name=item.filename; parts=pathlib.PurePosixPath(name).parts
   if name.startswith('/') or '..' in parts or '\\' in name: findings.append((filename,name,'unsafe-path'))
   if (item.external_attr >> 16) & 0o170000 == 0o120000: findings.append((filename,name,'symlink'))
   if item.file_size>32*1024*1024: findings.append((filename,name,'oversize'));continue
   total+=item.file_size
   if item.is_dir(): continue
   if not re.search(r'\.sdPlugin/(?:manifest\.json|bin/(?:plugin\.js|package\.json)|ui/inspector\.(?:html|js)|imgs/[\w/@.-]+\.(?:png|svg)|tools/(?:connect-claude|claude-statusline)\.mjs|licenses/[^/]+)$',name): findings.append((filename,name,'not-allowlisted'))
   raw=archive.read(item)
   if b'\x00' not in raw:
    text=raw.decode('utf8',errors='replace')
    for email in re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',text):
     if email not in ['einaros@gmail.com'] and not email.endswith(('@example.invalid','@example.com')): findings.append((filename,name,'unreviewed-email'))
    for rule,pat in [('private-key',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),('token',r'(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,})'),('personal-path',r'/Users/a[d]am/|C:\\Users\\Adam\\'),('canary',r'AI_USAGE_(?:TEST|PRIVATE)_[A-Z0-9_]+')]:
     if re.search(pat,text,re.I): findings.append((filename,name,rule))
  if total>100*1024*1024: findings.append((filename,'','total-size'))
  manifests=[n for n in names if n.endswith('/manifest.json')]
  if len(manifests)!=1: findings.append((filename,'','manifest-count'))
  reports.append({'file':pathlib.Path(filename).name,'sha256':hashlib.sha256(pathlib.Path(filename).read_bytes()).hexdigest(),'entries':len(names)})
if not findings:
 destination=pathlib.Path('.cache/package-scan')
 if destination.exists(): shutil.rmtree(destination)
 destination.mkdir(parents=True)
 for filename in sys.argv[1:]:
  with zipfile.ZipFile(filename) as archive: archive.extractall(destination)
print(json.dumps({'packages':reports,'findings':findings},indent=2))
sys.exit(bool(findings))
