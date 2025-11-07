# /*
# Copyright (c) 2025 Steve LLamb (https://github.com/SteveLLamb) and PrZ3(https://github.com/PrZ3r)
# 
# Redistribution and use in source and binary forms, with or without modification, 
# are permitted provided that the following conditions are met:
# 
# 1. Redistributions of source code must retain the above copyright notice, this
#    list of conditions and the following disclaimer.
# 
# 3. Redistributions in binary form must reproduce the above copyright notice, this
#    list of conditions and the following disclaimer in the documentation and/or
#    other materials provided with the distribution.
# 
# 4. Neither the name of the copyright holder nor the names of its contributors may
#    be used to endorse or promote products derived from this software without specific 
#    prior written permission.
# 
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND 
# ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED 
# WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
# DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE 
# FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL 
# DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR 
# SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER 
# CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR 
# TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF 
# THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
# */

import json
from optparse import OptionParser, OptionValueError

usage = "%prog [options] <input-file>"
parser = OptionParser(usage=usage)

parser.add_option("-n",
        action="store_true",
        dest="normative",
        default=True,
        help="Set reference check to Normative")
parser.add_option("-b",
        action="store_true",
        dest="bibliographic",
        default=True,
        help="Set reference check to Bibliographic")

options, args = parser.parse_args()
normative = options.normative
bibliographic = options.bibliographic

if normative:
  refType = "normative"
elif bibliographic:
  refType = "bibliographic"

if len(args) > 1:
        parser.error("You can only select a single input file!")
if len(args) < 1:
        parser.error("You must select an input file!")

docId = str(args).strip("[]'")


#def find_dependents(doc_id):
#
#  doc_is_required_by = is_required_by.get(doc_id)
#
#  if doc_is_required_by is None:
#    doc_is_required_by = set()
#    is_required_by[doc_id] = doc_is_required_by
#
#  for doc in documents:
#
#    if doc.get("group") != "27C":
#      continue
#
#    if "status" in doc and "superseded" in doc["status"] and  doc["status"]["superseded"]:
#      continue
#
#    if "references" not in doc or "normative" not in doc["references"]:
#      continue
#
#    if doc_id in doc["references"]["normative"]:
#
#      dependent_doc_id = doc["docId"]
#
#      if dependent_doc_id not in doc_is_required_by:
#        doc_is_required_by.add(dependent_doc_id)
#        find_dependents(dependent_doc_id)


def find_dependencies(docs_by_id, doc_id, deps):

  doc = docs_by_id[doc_id]

  if "references" not in doc or refType not in doc["references"]:
    return

  for dep_doc_id in doc["references"][refType]:

    if dep_doc_id in deps:
      continue

    deps.add(dep_doc_id)
    find_dependencies(docs_by_id, dep_doc_id, deps)


with open("../data/documents.json", encoding="utf-8") as fp:
  documents = json.load(fp)

docs_by_id = {}

for doc in documents:
  docs_by_id[doc["docId"]] = doc

deps = set()

find_dependencies(docs_by_id, docId, deps)

for dep_id in sorted(deps):
  dep = docs_by_id[dep_id]
  if  dep['status'].get('superseded', False):
    qual = "[S]"
  elif dep['status'].get('withdrawn', False):
    qual = "[W]"
  else:
    qual = ""
  print(f"{dep_id} ({dep['docLabel']}, {dep['docTitle']}) {qual}")
  #print(f"{dep['docLabel']} {qual}")

