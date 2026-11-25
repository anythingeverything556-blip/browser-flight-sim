#!/usr/bin/env python3
"""Selectively extract official FBW A380 visual source with system libarchive.
No source code, avionics executables, audio or simulator-owned assets extracted.
Usage: python3 tools/a380-extract.py official.7z source-output
"""
import ctypes as C, pathlib,sys
A=C.CDLL('libarchive.so.13'); A.archive_read_new.restype=C.c_void_p
for n in ['archive_read_support_filter_all','archive_read_support_format_all','archive_read_free']:getattr(A,n).argtypes=[C.c_void_p]
A.archive_read_open_filename.argtypes=[C.c_void_p,C.c_char_p,C.c_size_t]
A.archive_read_next_header.argtypes=[C.c_void_p,C.POINTER(C.c_void_p)]
A.archive_entry_pathname.argtypes=[C.c_void_p];A.archive_entry_pathname.restype=C.c_char_p
A.archive_read_data.argtypes=[C.c_void_p,C.c_void_p,C.c_size_t]; A.archive_read_data.restype=C.c_ssize_t
A.archive_error_string.argtypes=[C.c_void_p]; A.archive_error_string.restype=C.c_char_p
h=A.archive_read_new();A.archive_read_support_filter_all(h);A.archive_read_support_format_all(h)
assert A.archive_read_open_filename(h,str(pathlib.Path(sys.argv[1]).resolve()).encode(),10240)==0,A.archive_error_string(h)
e=C.c_void_p();buf=C.create_string_buffer(2**20);root=pathlib.Path(sys.argv[2]);root.mkdir(parents=True,exist_ok=True)
while True:
 status=A.archive_read_next_header(h,C.byref(e))
 if status==1:break
 assert status==0,A.archive_error_string(h)
 p=A.archive_entry_pathname(e).decode();tail=p.split('/FlyByWire_A380_842/',1)[-1]
 if tail==p or not (tail.startswith('model/') and tail.lower().endswith(('.gltf','.bin','.cfg')) or tail.startswith('texture/') and tail.lower().endswith(('.dds','.json','.cfg'))):continue
 out=root/tail
 if out.exists():continue
 out.parent.mkdir(parents=True,exist_ok=True)
 with out.open('wb') as f:
  while True:
   n=A.archive_read_data(h,buf,len(buf));assert n>=0,A.archive_error_string(h)
   if not n:break
   f.write(buf.raw[:n])
 print(tail,flush=True)
A.archive_read_free(h)
