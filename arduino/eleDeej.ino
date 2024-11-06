const uint8_t analogInputs[] = {A0, A1, A2, A3}; // connected arduino pins
const String deejName = "deej";                  // descriptive and unique name of your deej
const bool revert = true;                        // revert the values eg. 1023 -> 0

// the size of the average window as exponent (the window size will be 2^N_EXP)
const int N_EXP = 7;
const int NUM_SLIDERS = sizeof(analogInputs) / sizeof(uint8_t);

// slider average value expressed in fixed point arithmetic (multiplier 2^53)
typedef uint64_t FixedFract;
const unsigned int MUL_EXP = 53; // the default mul is 2^53 as the pin values are < 2^10 and 2^10 * 2^53 < 2^64
FixedFract analogSliderAvg[NUM_SLIDERS];

inline FixedFract toFixedPoint(int val)
{
  return ((FixedFract)val) << MUL_EXP;
}

inline FixedFract mapToRange(FixedFract val, int oldMax, int newMax)
{
  return (val / oldMax) * newMax + (toFixedPoint(1) >> 1);
}

inline int roundToInt(FixedFract val)
{
  // value + 0.5 so trunc to int will round to closes number
  FixedFract rounded = val + (1 << (MUL_EXP - 1));

  return rounded >> MUL_EXP;
}

void setup()
{
  for (int i = 0; i < NUM_SLIDERS; i++)
  {
    pinMode(analogInputs[i], INPUT);
    analogSliderAvg[i] = 0;
  }

  Serial.begin(9600);
}

String readString = "";
String command = "";

void loop()
{
  // read all the available characters from the serial up to the new line character
  char lastChar;
  while (Serial.available() > 0 && (lastChar = Serial.read()) != '\n')
  {
    readString += lastChar;
  }

  // if new line is read then copy buffer to the command
  if (lastChar == '\n')
  {
    command = readString;
    readString = "";
  }

  // update slider values
  updateSliderValues();

  // perform the commands
  if (command == "desc")
  {
    Serial.println(deejName);
  }

  if (command == "vol")
  {
    sendSliderValues();
  }

  // clean the command
  if (command.length() > 0)
  {
    command = "";
  }

  delay(1);
}

void updateSliderValues()
{
  for (int i = 0; i < NUM_SLIDERS; i++)
  {
    int newSample = analogRead(analogInputs[i]);

    // update moving average
    if (analogSliderAvg[i] == -1)
    {
      analogSliderAvg[i] = toFixedPoint(newSample);
    }
    else
    {
      analogSliderAvg[i] -= analogSliderAvg[i] >> N_EXP;
      analogSliderAvg[i] += toFixedPoint(newSample) >> N_EXP;
    }
  }
}

void sendSliderValues()
{
  String builtString = String("");

  for (int i = 0; i < NUM_SLIDERS; i++)
  {
    int printVal = roundToInt(mapToRange(analogSliderAvg[i], 1023, 100));
    if (revert)
    {
      printVal = 100 - printVal;
    }
    builtString += String(printVal);

    if (i < NUM_SLIDERS - 1)
    {
      builtString += String("|");
    }
  }

  Serial.println(builtString);
}
