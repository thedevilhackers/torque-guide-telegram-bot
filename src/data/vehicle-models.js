// Makes and models for the tuning file order form: cars sold in India (current and recent), popular
// imports, and the main bikes, trucks and tractors tuners see. Names only, for choosing from a list;
// engines and figures come from the vehicle database (src/seed-data.js) where it has the car, or the
// customer types them. Add a model here and it appears in the form's list.
export const VEHICLE_MODELS = {
  "Ashok Leyland": ["Boss", "Captain", "Dost", "Ecomet", "Partner", "Stile"],
  Audi: ["A3", "A4", "A5", "A6", "A8", "e-tron", "Q2", "Q3", "Q5", "Q7", "Q8", "R8", "RS3", "RS4", "RS5", "RS6", "RS7", "RS Q8", "S4", "S5", "TT", "TT RS"],
  Bajaj: ["Avenger 220", "Dominar 250", "Dominar 400", "Pulsar 150", "Pulsar 220F", "Pulsar N250", "Pulsar NS160", "Pulsar NS200", "Pulsar RS200"],
  BharatBenz: ["1617R", "2823R", "3523R", "4228R"],
  BMW: ["1 Series", "2 Series Gran Coupe", "3 Series", "3 Series Gran Limousine", "3 Series GT", "5 Series", "6 Series GT", "7 Series", "i4", "iX", "M2", "M3", "M4", "M5", "M8", "X1", "X3", "X4", "X5", "X5 M", "X6", "X7", "Z4"],
  Chevrolet: ["Aveo", "Beat", "Captiva", "Cruze", "Enjoy", "Optra", "Sail", "Spark", "Tavera", "Trailblazer"],
  Citroen: ["Basalt", "C3", "C3 Aircross", "C5 Aircross", "eC3"],
  Eicher: ["Pro 2049", "Pro 2110", "Pro 3015", "Pro 6028", "Skyline"],
  Fiat: ["Avventura", "Grande Punto", "Linea", "Palio", "Punto", "Punto Evo", "Urban Cross"],
  "Force Motors": ["Gurkha", "Traveller", "Trax", "Urbania"],
  Ford: ["EcoSport", "Endeavour", "Fiesta", "Figo", "Figo Aspire", "Freestyle", "Fusion", "Ikon", "Mustang", "Ranger"],
  Hero: ["Karizma XMR", "Mavrick 440", "Xpulse 200", "Xtreme 160R"],
  Honda: ["Accord", "Amaze", "Brio", "BR-V", "City", "City Hybrid", "Civic", "CR-V", "Elevate", "Jazz", "Mobilio", "WR-V"],
  Hyundai: ["Accent", "Alcazar", "Aura", "Creta", "Creta N Line", "Elantra", "Eon", "Exter", "Getz", "Grand i10", "Grand i10 Nios", "i10", "i20", "i20 N Line", "Ioniq 5", "Kona Electric", "Santa Fe", "Santro", "Sonata", "Tucson", "Venue", "Venue N Line", "Verna", "Xcent"],
  Isuzu: ["D-Max", "D-Max V-Cross", "MU-7", "MU-X"],
  Jaguar: ["E-Pace", "F-Pace", "F-Type", "I-Pace", "XE", "XF", "XJ"],
  Jeep: ["Compass", "Grand Cherokee", "Meridian", "Wrangler"],
  "John Deere": ["5050 D", "5105", "5310", "5405"],
  Kawasaki: ["Ninja 300", "Ninja 400", "Ninja 650", "Ninja ZX-10R", "Versys 650", "Z650", "Z900"],
  Kia: ["Carens", "Carnival", "EV6", "EV9", "Seltos", "Sonet", "Syros"],
  KTM: ["390 Adventure", "Duke 200", "Duke 250", "Duke 390", "RC 200", "RC 390"],
  "Land Rover": ["Defender", "Discovery", "Discovery Sport", "Freelander 2", "Range Rover", "Range Rover Evoque", "Range Rover Sport", "Range Rover Velar"],
  Lexus: ["ES", "LM", "LS", "LX", "NX", "RX"],
  Mahindra: ["Alturas G4", "BE 6", "Bolero", "Bolero Neo", "KUV100", "Marazzo", "Quanto", "Scorpio", "Scorpio Classic", "Scorpio-N", "Thar", "Thar Roxx", "TUV300", "XEV 9e", "XUV 3XO", "XUV300", "XUV400", "XUV500", "XUV700", "Xylo"],
  "Maruti Suzuki": ["800", "A-Star", "Alto", "Alto 800", "Alto K10", "Baleno", "Brezza", "Celerio", "Ciaz", "Dzire", "Eeco", "Ertiga", "Esteem", "Fronx", "Grand Vitara", "Gypsy", "Ignis", "Invicto", "Jimny", "Omni", "Ritz", "S-Cross", "S-Presso", "Swift", "SX4", "Vitara Brezza", "Wagon R", "XL6", "Zen", "Zen Estilo"],
  "Mercedes-Benz": ["A-Class", "A-Class Limousine", "AMG GT", "C-Class", "CLA", "E-Class", "EQS", "G-Class", "GLA", "GLB", "GLC", "GLE", "GLS", "Maybach S-Class", "S-Class"],
  MG: ["Astor", "Comet EV", "Gloster", "Hector", "Hector Plus", "Windsor EV", "ZS EV"],
  Mini: ["Clubman", "Convertible", "Cooper", "Cooper S", "Countryman", "John Cooper Works"],
  Mitsubishi: ["Cedia", "Lancer", "Outlander", "Pajero", "Pajero Sport"],
  Nissan: ["Evalia", "GT-R", "Kicks", "Magnite", "Micra", "Sunny", "Teana", "Terrano", "X-Trail"],
  Porsche: ["718 Boxster", "718 Cayman", "911", "Cayenne", "Cayenne Coupe", "Macan", "Panamera", "Taycan"],
  Renault: ["Captur", "Duster", "Fluence", "Kiger", "Koleos", "Kwid", "Lodgy", "Pulse", "Scala", "Triber"],
  "Royal Enfield": ["Bullet 350", "Classic 350", "Continental GT 650", "Guerrilla 450", "Himalayan", "Himalayan 450", "Hunter 350", "Interceptor 650", "Meteor 350", "Scram 411", "Super Meteor 650"],
  Skoda: ["Fabia", "Kodiaq", "Kushaq", "Kylaq", "Laura", "Octavia", "Octavia RS", "Rapid", "Slavia", "Superb", "Yeti"],
  Sonalika: ["DI 35", "DI 745 III", "Sikander DI 750 III", "Tiger DI 55"],
  Swaraj: ["717", "744 FE", "855 FE", "963 FE"],
  Tata: ["Altroz", "Altroz Racer", "Aria", "Bolt", "Curvv", "Harrier", "Hexa", "Indica", "Indigo", "Nano", "Nexon", "Nexon EV", "Punch", "Safari", "Sumo", "Tiago", "Tigor", "Yodha", "Zest"],
  Toyota: ["Camry", "Corolla", "Corolla Altis", "Etios", "Etios Cross", "Etios Liva", "Fortuner", "Fortuner Legender", "Glanza", "Hilux", "Innova", "Innova Crysta", "Innova Hycross", "Land Cruiser", "Qualis", "Rumion", "Urban Cruiser", "Urban Cruiser Hyryder", "Urban Cruiser Taisor", "Vellfire", "Yaris"],
  TVS: ["Apache RR 310", "Apache RTR 160 4V", "Apache RTR 200 4V", "Apache RTR 310", "Ronin"],
  Volkswagen: ["Ameo", "Beetle", "Golf", "Golf GTI", "Jetta", "Passat", "Polo", "Polo GT", "T-Roc", "Taigun", "Tiguan", "Touareg", "Vento", "Virtus"],
  Volvo: ["C40 Recharge", "S60", "S90", "V40", "XC40", "XC60", "XC90"],
  Yamaha: ["FZ-S", "FZ25", "MT-15", "R15", "R3"]
};

// Makes that build bikes, trucks or tractors, so choosing one sets the vehicle type (cars otherwise).
export const MAKE_TYPES = {
  "Ashok Leyland": "truck", Bajaj: "bike", BharatBenz: "truck", Eicher: "truck", Hero: "bike", "John Deere": "agri", Kawasaki: "bike",
  KTM: "bike", "Royal Enfield": "bike", Sonalika: "agri", Swaraj: "agri", TVS: "bike", Yamaha: "bike"
};
