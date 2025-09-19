import {
  PrismaClient,
  Gender,
  Relationship,
  Role,
  ProcessingStageStatus,
  Prisma,
} from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface SeedDistrictEntry {
  state: string;
  stateCode: string;
  districtCode: string;
  district: string;
  headquarters?: string;
  population?: number;
  area?: number;
  density?: number;
}

interface LocationData {
  districts: SeedDistrictEntry[];
}

let indianLocationData: LocationData = { districts: [] };
const jsonPath = path.resolve(__dirname, "data", "districts.json");
try {
  const rawData = fs.readFileSync(jsonPath, "utf-8");
  indianLocationData = JSON.parse(rawData);
  console.log(
    `Successfully loaded ${indianLocationData.districts.length} district entries from JSON.`
  );
} catch (error) {
  console.error(
    `Failed to load districts.json for seeding. Ensure the file exists at '${jsonPath}'`,
    error
  );
}

const allStatesFromData = Array.from(
  new Set(indianLocationData.districts.map(d => d.state))
).sort();

function getRandomStateAndDistrict(): {
  state: string;
  district: string;
  mandal: string;
  village: string;
  panchayath: string;
} {
  if (indianLocationData.districts.length === 0) {
    console.warn("District data not loaded. Using fallback location details.");
    return {
      state: "Fallback State",
      district: "Fallback District",
      mandal: "Fallback Mandal",
      village: "Fallback Village",
      panchayath: "Fallback GP",
    };
  }

  const randomEntry = getRandomElement(indianLocationData.districts);
  const randomSuffix = Math.floor(Math.random() * 100) + 1;
  return {
    state: randomEntry.state,
    district: randomEntry.district,
    mandal: `${randomEntry.district} Mandal ${randomSuffix}`,
    village: `${randomEntry.district} Village ${randomSuffix}`,
    panchayath: `${randomEntry.district} GP ${randomSuffix}`,
  };
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

const getRandomElement = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

const firstNames = [
  "Ramesh",
  "Suresh",
  "Priya",
  "Anjali",
  "Vijay",
  "Deepa",
  "Arun",
  "Lakshmi",
];
const lastNames = [
  "Kumar",
  "Patel",
  "Reddy",
  "Sharma",
  "Naidu",
  "Singh",
  "Gupta",
  "Rao",
];
const communities = ["BC", "OC", "SC", "ST", "Minority"];
const bankNames = [
  "State Bank of India",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Canara Bank",
];
const branchNames = [
  "Main Branch",
  "City Center",
  "Industrial Area",
  "Rural Branch",
];
const crops = ["Turmeric", "Coffee", "Ginger", "Pepper"];
const turmericForms = [
  "Fresh Finger",
  "Fresh Bulb",
  "Dried Finger",
  "Dried Bulb",
];
const coffeeForms = ["Fruit", "Dry Cherry", "Parchment"];
const gingerForms = ["Fresh", "Dried"];
const pepperForms = ["Green Pepper", "Black Pepper"];
const specialities = ["Organic", "Non-GMO", "Fair Trade", "Standard"];
const processMethods = ["wet", "dry"] as const;

function getRandomAadhar(): string {
  return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

function getRandomPhone(): string {
  return Math.floor(6000000000 + Math.random() * 4000000000).toString();
}

function getRandomIFSC(bankName: string): string {
  const bankCode = bankName.substring(0, 4).toUpperCase();
  const randomNum = Math.floor(1000000 + Math.random() * 9000000).toString();
  return `${bankCode}0${randomNum.substring(0, 6)}`;
}

function getRandomAccountNumber(): string {
  return Math.floor(10000000000 + Math.random() * 90000000000).toString();
}

function getRandomDate(startYear: number, endYear: number): Date {
  const year =
    startYear + Math.floor(Math.random() * (endYear - startYear + 1));
  const month = Math.floor(Math.random() * 12);
  const day = Math.floor(Math.random() * 28) + 1;
  return new Date(year, month, day);
}

function getCropSpecificProcuredForm(crop: string): string {
  switch (crop) {
    case "Turmeric":
      return getRandomElement(turmericForms);
    case "Coffee":
      return getRandomElement(coffeeForms);
    case "Ginger":
      return getRandomElement(gingerForms);
    case "Pepper":
      return getRandomElement(pepperForms);
    default:
      return "Generic Form";
  }
}

let surveyNumberCounter = 1;
function generateSeedSurveyNumber(): string {
  return `CHYA${String(surveyNumberCounter++).padStart(8, "0")}`;
}

let procurementNumberCounter = 1;
function generateSeedProcurementNumber(
  crop: string,
  date: Date,
  lotNo: number
): string {
  const cropCode = crop.slice(0, 3).toUpperCase();
  const dateStr = `${date.getFullYear()}${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}${date.getDate().toString().padStart(2, "0")}`;
  return `PROC-${cropCode}-${lotNo}-${dateStr}-${String(
    procurementNumberCounter++
  ).padStart(3, "0")}`;
}

let batchCodeCounter = 1;
function generateSeedProcessingBatchCode(
  crop: string,
  lotNo: number,
  dateOfProcessing: Date
): string {
  const cropCode = crop.slice(0, 3).toUpperCase();
  const dateStr = `${dateOfProcessing.getFullYear()}${(
    dateOfProcessing.getMonth() + 1
  )
    .toString()
    .padStart(2, "0")}${dateOfProcessing
    .getDate()
    .toString()
    .padStart(2, "0")}`;
  return `PBC-${cropCode}-${lotNo}-${dateStr}-S${String(
    batchCodeCounter++
  ).padStart(3, "0")}`;
}

function generateSeedVehicleNumber(): string {
  return `AP${String(Math.floor(Math.random() * 30) + 1).padStart(
    2,
    "0"
  )}X${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

async function main() {
  console.log("Start seeding ...");

  const adminPassword = await hashPassword("Admin@123");
  const staffPassword = await hashPassword("Staff@123");

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@chaya.com" },
    update: {
      name: "Admin User",
      password: adminPassword,
      role: Role.ADMIN,
      isEnabled: true,
      isActive: false,
    },
    create: {
      name: "Admin User",
      email: "admin@chaya.com",
      password: adminPassword,
      role: Role.ADMIN,
      isEnabled: true,
      isActive: false,
    },
  });
  console.log(
    `Created or updated admin user: ${adminUser.name} (ID: ${adminUser.id})`
  );

  const staffUser = await prisma.user.upsert({
    where: { email: "staff@chaya.com" },
    update: {
      name: "Staff User",
      password: staffPassword,
      role: Role.STAFF,
      isEnabled: true,
      isActive: false,
    },
    create: {
      name: "Staff User",
      email: "staff@chaya.com",
      password: staffPassword,
      role: Role.STAFF,
      isEnabled: true,
      isActive: false,
    },
  });
  console.log(
    `Created or updated staff user: ${staffUser.name} (ID: ${staffUser.id})`
  );

  const createdFarmers: any[] = [];

  for (let i = 0; i < 25; i++) {
    const dob = getRandomDate(1950, 2000);
    const age = new Date().getFullYear() - dob.getFullYear();
    const farmerName = `${getRandomElement(firstNames)} ${getRandomElement(
      lastNames
    )}`;
    const selectedBankName = getRandomElement(bankNames);
    const locationDetails = getRandomStateAndDistrict();

    const farmerData: Prisma.FarmerCreateInput = {
      surveyNumber: generateSeedSurveyNumber(),
      name: farmerName,
      relationship: getRandomElement(Object.values(Relationship)),
      gender: getRandomElement(Object.values(Gender)),
      community: getRandomElement(communities),
      aadharNumber: getRandomAadhar(),
      state: locationDetails.state,
      district: locationDetails.district,
      mandal: locationDetails.mandal,
      village: locationDetails.village,
      panchayath: locationDetails.panchayath,
      dateOfBirth: dob,
      age: age,
      contactNumber: getRandomPhone(),
      isActive: Math.random() > 0.1,
      createdBy: { connect: { id: adminUser.id } },
      updatedBy: { connect: { id: adminUser.id } },
      bankDetails: {
        create: {
          ifscCode: getRandomIFSC(selectedBankName),
          bankName: selectedBankName,
          branchName: getRandomElement(branchNames),
          accountNumber: getRandomAccountNumber(),
          address: `${locationDetails.village}, ${locationDetails.district}`,
          bankCode: selectedBankName.substring(0, 3).toUpperCase(),
        },
      },
      documents: {
        create: {
          profilePicUrl: `https://source.unsplash.com/random/200x200?person&sig=${i}`,
          aadharDocUrl: `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf?id=aadhar${i}`,
          bankDocUrl: `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf?id=bank${i}`,
        },
      },
      fields: {
        create: Array.from({ length: Math.floor(Math.random() * 2) + 1 }).map(
          (_, j) => ({
            areaHa: parseFloat((Math.random() * 5 + 0.5).toFixed(2)),
            yieldEstimate: parseFloat((Math.random() * 1000 + 100).toFixed(2)),
            location: {
              lat: 17.0 + Math.random() * 1.0,
              lng: 78.0 + Math.random() * 1.0,
              accuracy: Math.random() * 50 + 5,
              altitude: Math.random() > 0.5 ? Math.random() * 100 + 500 : null,
              altitudeAccuracy:
                Math.random() > 0.5 ? Math.random() * 20 + 1 : null,
              timestamp: Date.now() - Math.floor(Math.random() * 10000000),
            },
            landDocumentUrl: `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf?id=land${i}-${j}`,
          })
        ),
      },
    };

    const farmer = await prisma.farmer.create({ data: farmerData });
    createdFarmers.push(farmer);
    console.log(
      `Created farmer: ${farmer.name} (State: ${farmer.state}, District: ${farmer.district})`
    );
  }

  const createdProcurements: any[] = [];
  for (let i = 0; i < 15; i++) {
    const randomFarmer = getRandomElement(createdFarmers);
    const procurementDate = getRandomDate(2023, 2024);
    const procurementTime = new Date(procurementDate);
    procurementTime.setHours(
      Math.floor(Math.random() * 8) + 9,
      Math.floor(Math.random() * 60),
      Math.floor(Math.random() * 60)
    );

    const selectedCrop = getRandomElement(crops);
    const lotNumber = getRandomElement([1, 2, 3]);

    const procurementData: Prisma.ProcurementCreateInput = {
      procurementNumber: generateSeedProcurementNumber(
        selectedCrop,
        procurementDate,
        lotNumber
      ),
      farmer: { connect: { id: randomFarmer.id } },
      crop: selectedCrop,
      procuredForm: getCropSpecificProcuredForm(selectedCrop),
      speciality: getRandomElement(specialities),
      quantity: parseFloat((Math.random() * 500 + 50).toFixed(2)),
      date: procurementDate,
      time: procurementTime,
      lotNo: lotNumber,
      procuredBy: staffUser.name,
      vehicleNo: generateSeedVehicleNumber(),
    };
    const procurement = await prisma.procurement.create({
      data: procurementData,
    });
    createdProcurements.push(procurement);
    console.log(
      `Created procurement: ${procurement.procurementNumber} for Farmer ID ${randomFarmer.id}`
    );
  }

  const availableProcurementsForBatching = [...createdProcurements];
  for (let i = 0; i < 5; i++) {
    if (availableProcurementsForBatching.length < 1) break;

    const firstProcForBatch = availableProcurementsForBatching.shift()!;
    const batchCrop = firstProcForBatch.crop;
    const batchLotNo = firstProcForBatch.lotNo;

    const procurementsForThisBatchIds: number[] = [firstProcForBatch.id];
    let batchInitialQuantity = firstProcForBatch.quantity;

    const numAdditionalProcs = Math.floor(Math.random() * 2);
    for (
      let k = 0;
      k < numAdditionalProcs && availableProcurementsForBatching.length > 0;
      k++
    ) {
      const compatibleProcIndex = availableProcurementsForBatching.findIndex(
        p => p.crop === batchCrop && p.lotNo === batchLotNo
      );
      if (compatibleProcIndex !== -1) {
        const additionalProc = availableProcurementsForBatching.splice(
          compatibleProcIndex,
          1
        )[0];
        procurementsForThisBatchIds.push(additionalProc.id);
        batchInitialQuantity += additionalProc.quantity;
      } else {
        break;
      }
    }

    const p1Date = getRandomDate(2024, 2024);

    const batchData: Prisma.ProcessingBatchCreateInput = {
      batchCode: generateSeedProcessingBatchCode(batchCrop, batchLotNo, p1Date),
      crop: batchCrop,
      lotNo: batchLotNo,
      initialBatchQuantity: batchInitialQuantity,
      createdBy: { connect: { id: adminUser.id } },
      procurements: {
        connect: procurementsForThisBatchIds.map(id => ({ id })),
      },
      processingStages: {
        create: [
          {
            processingCount: 1,
            processMethod: getRandomElement(processMethods),
            dateOfProcessing: p1Date,
            doneBy: staffUser.name,
            initialQuantity: batchInitialQuantity,
            status: ProcessingStageStatus.IN_PROGRESS,
            createdById: adminUser.id,
            dryingEntries: {
              create: Array.from({
                length: Math.floor(Math.random() * 3) + 1,
              }).map((_, dayIndex) => {
                const dayQuantityReduction =
                  batchInitialQuantity *
                  (0.02 * (dayIndex + 1) + Math.random() * 0.01);
                return {
                  day: dayIndex + 1,
                  temperature: parseFloat((20 + Math.random() * 15).toFixed(1)),
                  humidity: parseFloat((40 + Math.random() * 40).toFixed(1)),
                  pH: parseFloat((6.0 + Math.random() * 1.5).toFixed(1)),
                  moisturePercentage: parseFloat(
                    (10 + Math.random() * 10).toFixed(1)
                  ),
                  currentQuantity: parseFloat(
                    (batchInitialQuantity - dayQuantityReduction).toFixed(2)
                  ),
                };
              }),
            },
          },
        ],
      },
    };

    const processingBatch = await prisma.processingBatch.create({
      data: batchData,
    });
    console.log(`Created processing batch: ${processingBatch.batchCode}`);
  }

  console.log("Seeding finished.");
}

main()
  .catch(e => {
    console.error(e);
    throw e;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
