# Builds src/booklet-hi.html from the Hindi page files and the English edition's scripts.
import re, pathlib
src = pathlib.Path(__file__).parent / "src"
en = (src / "booklet.html").read_text(encoding="utf-8")
pages = "".join((src / "hi" / f"p{i}.html").read_text(encoding="utf-8") for i in range(1, 5))
pages = pages.replace("आल्फ़्रेड बुकी", "आल्फ़्रेड ब्यूकी")

scripts = en[en.index("<script>\n// Power figures"):en.index("</body>")]
scripts = scripts.replace('${fuel === "d" ? "Diesel" : "Petrol"}', '${fuel === "d" ? "डीज़ल" : "पेट्रोल"}')
scripts = scripts.replace('<span>The Tuning Book</span><b>', '<span>ट्यूनिंग बुक</span><b>')
quips_hi = '''const QUIPS = {
  contents: "क्रम से पढ़ें, या सीधे तस्वीरों पर जाएँ। हम कुछ नहीं कहेंगे।",
  power: "आपका इंजन: अपनी राय रखने वाला एक महँगा एयर पंप।",
  ecu: "ECU एक सेकंड में जितने फ़ैसले लेता है, हम हफ़्ते भर में नहीं लेते।",
  maps: "मैप एक ऐसी स्प्रेडशीट है जिसे इंजन सच में पढ़ता है।",
  why: "गैराज ज्ञान: वही गाड़ी, नया जोश।",
  stages: "स्टेज 1 एक क़दम है। स्टेज 3 एक लाइफ़स्टाइल।",
  numbers: "चेतावनी: ये नंबर आपको कार-दीवाना बना सकते हैं।",
  stage1: "न नए पार्ट्स, न झंझट। बस ज़्यादा खिंचाव।",
  s1changes: "पेट्रोल हो या डीज़ल, इंजन मैप लिखने वाले की ही सुनता है।",
  process: "दो बार नापो, एक बार फ़्लैश करो।",
  stage2: "साँस अंदर, साँस बाहर। इंजन यह मिनट में हज़ारों बार करता है।",
  intercooler: "गैराज ज्ञान: हवा ठंडी, इंजन ख़ुश।",
  intake: "कोन फ़िल्टर दिखते कूल हैं। फ़्यूल ट्रिम शायद न मानें।",
  downpipe: "एग्ज़ॉस्ट का चौड़ा रास्ता। जैसे ज़्यादा गेट वाला स्टेडियम।",
  plugs: "हर स्पार्क में 40,000 वोल्ट तक। उँगली से टेस्ट न करें।",
  diesel: "डीज़ल: स्पार्क नहीं, सिर्फ़ टॉर्क।",
  stage3: "बड़ा टर्बो, बड़े इरादे, बड़ी मुस्कान।",
  turbo: "टर्बो: समझिए एग्ज़ॉस्ट से चलने वाला हेयर-ड्रायर।",
  turbochoice: "बड़ा टर्बो, बड़ा लैग, बड़ी मुस्कान। थोड़ी देर से।",
  fuel: "गैराज ज्ञान: हवा ज़्यादा, तो पेट्रोल भी ज़्यादा।",
  clutch: "क्लच तनाव झेलता है, ताकि गियरबॉक्स को न झेलना पड़े।",
  support: "ज़्यादा रफ़्तार से पहले, ज़्यादा अच्छे ब्रेक।",
  history: "इतिहास की क्लास ख़त्म। क्विज़ पेज {quiz} पर है।",
  "install-map": "चौदह पार्ट्स, एक ख़ुश कार।",
  "install-ic": "क्लैंप: बूस्ट रोकने लायक़ टाइट, सिलिकॉन बचाने लायक़ नरम।",
  "install-turbo": "पहले तेल, फिर स्टार्ट। टर्बो को सूखा स्टार्ट पसंद नहीं।",
  "install-plugs": "पुराने स्पार्क प्लग कहानियाँ सुनाते हैं। हम हर एक पढ़ते हैं।",
  "install-fuel": "पहले प्रेशर कम करें। फ़्यूल सिस्टम में भी, ज़िंदगी में भी।",
  ethanol: "गैराज ज्ञान: गन्ने का रस, अब टैंक में भी।",
  monitor: "भरोसा भगवान पर। बाक़ी सब डेटा लॉग लेकर आएँ।",
  health: "आज 'ना' कहना, कल 'सॉरी' कहने से बेहतर है।",
  figures: "ये अनुमान हैं। असली कहानी आपकी कार के लॉग बताते हैं।",
  care: "गरम तेल, ख़ुश टर्बो, ख़ुश मालिक।",
  promise: "न डीकैट। न शॉर्टकट। न बकवास।",
  faq: "कोई सवाल बेवकूफ़ी नहीं। सिवाय 'क्या 100 hp मुफ़्त मिलेगा?'",
  myths: "मिथक टूटे: 8. इंजन टूटे: 0.",
  glossary: "अब आप भी बूस्ट की बातें शान से कर सकते हैं।",
  quiz: "झाँकना मना है। जवाब उल्टे इसीलिए छपे हैं।",
  record: "भविष्य के आप, और अगला मालिक, शुक्रिया कहेंगे।",
  franchise: "आपका शहर। आपकी वर्कशॉप। हमारे स्टैंडर्ड।",
  "franchise-packages": "सब कुछ एक बॉक्स में। जुनून आपको लाना होगा।",
  "franchise-apply": "पहला क़दम एक WhatsApp मैसेज है। हमने इसे आसान बनाया है।",
};'''
scripts = re.sub(r"const QUIPS = \{.*?\n\};", lambda m: quips_hi, scripts, flags=re.S)
scripts = scripts.replace('<script src="illus.js"></script>', '<script src="tr-hi.js"></script>\n<script src="illus.js"></script>')
assert 'tr-hi.js' in scripts and 'डीज़ल' in scripts and 'गैराज ज्ञान' in scripts

head = '''<!doctype html>
<html lang="hi">
<head>
<meta charset="utf-8">
<title>ट्यूनिंग बुक · Unity Performance</title>
<link rel="stylesheet" href="booklet.css">
<link rel="stylesheet" href="booklet-hi.css">
<style id="pagesize">@page { size: 148mm 210mm; margin: 0; }</style>
</head>
<body>

'''
(src / "booklet-hi.html").write_text(head + pages + "\n" + scripts + "</body>\n</html>\n", encoding="utf-8")
print("pages:", (head + pages).count('<section class="page'))
