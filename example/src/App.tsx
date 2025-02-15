import { Text, View, StyleSheet } from 'react-native';
import { Calculator, type BinaryOperator, SafeAddition, ComputationResult } from '../../src';
import { ConvoManager } from '../../src';

// A Rust object
const calculator = new Calculator();
// A Rust object implementing the Rust trait BinaryOperator
const addOp = new SafeAddition();

// A Typescript class, implementing BinaryOperator
class SafeMultiply implements BinaryOperator {
  perform(lhs: bigint, rhs: bigint): bigint {
    return lhs * rhs;
  }
}
const multOp = new SafeMultiply();

// bigints
const three = 3n;
const seven = 7n;

// Perform the calculation, and to get an object
// representing the computation result.
const computation: ComputationResult = calculator
  .calculate(addOp, three, three)
  .calculateMore(multOp, seven)
  .lastResult()!;

// Unpack the bigint value into a string.
const result = computation.value.toString();

const convoManager = new ConvoManager('test');


export default function App() {
  convoManager.createNewGroup('test');
  return (
    <View style={styles.container}>
      <Text>Result: {result}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
